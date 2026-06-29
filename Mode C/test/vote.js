const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("hardhat");
const snarkjs = require("snarkjs");
const { groth16, wtns } = snarkjs;
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const { performance } = require("perf_hooks");

const { getContract } = require("../configs/blockchain");
const { uploadToIPFS } = require("../utils/ipfs");

const VOTER_DB_FILE = path.join(
  __dirname,
  "../data/voter_data_for_db_100000.json",
);
const VOTER_SECRETS_FILE = path.join(
  __dirname,
  "../data/voter_secrets_for_script_100000.json",
);
const DKG_PUBLIC_KEY_PATH = path.join(
  __dirname,
  "../data/dkgKeys/public_key.json",
);

const WASM_PATH = path.join(
  __dirname,
  "../circuits/build/VoteProofCombined/VoteProofCombined_js/VoteProofCombined.wasm",
);
const ZKEY_PATH = path.join(
  __dirname,
  "../circuits/build/VoteProofCombined/VoteProofCombined.zkey",
);
const VKEY_PATH = path.join(
  __dirname,
  "../circuits/build/VoteProofCombined/VoteProofCombined_vkey.json",
);

const VOTE_OUT_FILE = path.join(__dirname, "../data/vote.json");
const CSV_FILE = path.join(__dirname, "../data/vote_submission_times.csv");
const WITNESS_DIR = path.join(__dirname, "../data/tmp_witness");

const MODE = "C";

const ELECTION_ID = "ELC2026";
const NUM_CANDIDATES = 2;
const NUM_SELECTIONS = 1;
const VOTES_TO_SIMULATE = 10;
const VOTE_BATCH_SIZE = 2000;

const TOTAL_TRUSTEES = 3;
const THRESHOLD = 2;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createVoteWriter(filePath, batchSize = 1000) {
  const stream = fs.createWriteStream(filePath, { flags: "w" });
  let buffer = [];
  let isFirstVote = true;

  stream.write("[\n");

  function flush() {
    if (buffer.length === 0) return;

    let chunk = "";
    for (const vote of buffer) {
      if (!isFirstVote) chunk += ",\n";
      chunk += JSON.stringify(vote, null, 2);
      isFirstVote = false;
    }

    stream.write(chunk);
    buffer = [];
  }

  return {
    addVote(vote) {
      buffer.push(vote);
      if (buffer.length >= batchSize) flush();
    },

    async close() {
      flush();
      await new Promise((resolve, reject) => {
        stream.on("error", reject);
        stream.end("\n]\n", resolve);
      });
    },
  };
}

function resetCSV() {
  fs.writeFileSync(
    CSV_FILE,
    "voter,mode,gasUsed,endToEndTimeMs,witnessTimeMs,proofGenerationTimeMs,resultCode\n",
    "utf8",
  );
}

function appendCSVData(data) {
  const row = [
    data.voter,
    data.mode,
    data.gasUsed,
    data.endToEndTimeMs,
    data.witnessTimeMs,
    data.proofGenerationTimeMs,
    data.resultCode,
  ].join(",") + "\n";

  fs.appendFileSync(CSV_FILE, row, "utf8");
}

function hashElectionId(poseidon, value) {
  const F = poseidon.F;
  const chars = Array.from(value).map((char) => BigInt(char.charCodeAt(0)));
  return F.toObject(poseidon(chars)).toString();
}

function pickRandomChoices(numCandidates, numSelections) {
  if (numSelections > numCandidates) {
    throw new Error("numSelections cannot be greater than numCandidates");
  }

  const indices = Array.from({ length: numCandidates }, (_, i) => i);

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, numSelections);
}

async function encryptVote(
  babyjub,
  publicKeyX,
  publicKeyY,
  numCandidates,
  selectedChoices,
) {
  const F = babyjub.F;
  const G = babyjub.Base8;
  const n = babyjub.subOrder;
  const publicKey = [F.e(publicKeyX), F.e(publicKeyY)];

  const messages = Array(numCandidates).fill(0n);
  for (const idx of selectedChoices) {
    if (idx < 0 || idx >= numCandidates) {
      throw new Error(`Invalid selected choice index: ${idx}`);
    }
    messages[idx] = 1n;
  }

  const randomness = Array.from({ length: numCandidates }, () => {
    const randomBytes = crypto.randomBytes(32);
    return BigInt(`0x${randomBytes.toString("hex")}`) % n;
  });

  const C1x = [];
  const C1y = [];
  const C2x = [];
  const C2y = [];

  for (let i = 0; i < numCandidates; i++) {
    const C1 = babyjub.mulPointEscalar(G, randomness[i]);
    const rPK = babyjub.mulPointEscalar(publicKey, randomness[i]);
    const mG = babyjub.mulPointEscalar(G, messages[i]);
    const C2 = babyjub.addPoint(mG, rPK);

    C1x.push(F.toObject(C1[0]).toString());
    C1y.push(F.toObject(C1[1]).toString());
    C2x.push(F.toObject(C2[0]).toString());
    C2y.push(F.toObject(C2[1]).toString());
  }

  return {
    m: messages.map(String),
    r: randomness.map(String),
    C1x,
    C1y,
    C2x,
    C2y,
  };
}

function buildVotePayload({ nullifier, hashCipherAll, cid }) {
  return {
    nullifier: ethers.zeroPadValue(ethers.toBeHex(BigInt(nullifier)), 32),
    hashCipherAll: ethers.zeroPadValue(
      ethers.toBeHex(BigInt(hashCipherAll)),
      32,
    ),
    cid,
  };
}

async function generateWitnessAndProof(witnessInput, voterId, index) {
  ensureDir(WITNESS_DIR);

  const witnessFile = path.join(
    WITNESS_DIR,
    `vote_${index}_${String(voterId)}.wtns`,
  );

  const witnessStart = performance.now();
  await wtns.calculate(witnessInput, WASM_PATH, witnessFile);
  const witnessEnd = performance.now();
  const witnessTimeMs = witnessEnd - witnessStart;

  const proofStart = performance.now();
  const { proof, publicSignals } = await groth16.prove(ZKEY_PATH, witnessFile);
  const proofEnd = performance.now();
  const proofGenerationTimeMs = proofEnd - proofStart;

  try {
    fs.unlinkSync(witnessFile);
  } catch (_) {}

  return {
    proof,
    publicSignals,
    witnessTimeMs,
    proofGenerationTimeMs,
  };
}

async function verifyAndSignByTrustee(
  trusteeSigner,
  votingContract,
  vKey,
  packet,
) {
  const isValid = await groth16.verify(
    vKey,
    packet.publicSignals,
    packet.proof,
  );
  if (!isValid) {
    throw new Error(
      `Trustee ${await trusteeSigner.getAddress()} rejected invalid proof`,
    );
  }

  const digest = await votingContract
    .connect(trusteeSigner)
    .getVoteApprovalDigest(
      packet.votePayload.nullifier,
      packet.votePayload.hashCipherAll,
      packet.votePayload.cid,
    );

  return trusteeSigner.signMessage(ethers.getBytes(digest));
}

function createVoteSubmitter(votingContract) {
  const seen = new Set();

  return async function submitVoteWithThreshold(packet, signatures) {
    const key = `${packet.votePayload.nullifier}`;
    if (seen.has(key)) {
      return { code: 2, gasUsed: 0n };
    }

    const tx = await votingContract.submitVoteWithTrusteeSignatures(
      packet.votePayload.nullifier,
      packet.votePayload.hashCipherAll,
      packet.votePayload.cid,
      signatures,
    );

    const receipt = await tx.wait();
    seen.add(key);

    return {
      code: 0,
      gasUsed: receipt.gasUsed ?? 0n,
    };
  };
}

async function main() {
  if (THRESHOLD <= 0 || THRESHOLD > TOTAL_TRUSTEES) {
    throw new Error("Invalid THRESHOLD/TOTAL_TRUSTEES config");
  }

  if (!fs.existsSync(DKG_PUBLIC_KEY_PATH)) {
    throw new Error("public_key.json not found. Run register.js first.");
  }

  if (!fs.existsSync(VKEY_PATH)) {
    throw new Error("VoteProofCombined_vkey.json not found.");
  }

  ensureDir(WITNESS_DIR);

  const publicKeyData = JSON.parse(
    fs.readFileSync(DKG_PUBLIC_KEY_PATH, "utf8"),
  );
  const publicKeyX = BigInt(publicKeyData.x);
  const publicKeyY = BigInt(publicKeyData.y);
  const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

  const voteWriter = createVoteWriter(VOTE_OUT_FILE, VOTE_BATCH_SIZE);
  resetCSV();

  const { votingContract: caContract, signer: caSigner } = await getContract(0);
  const trusteeSigners = [];

  for (let i = 1; i <= TOTAL_TRUSTEES; i++) {
    const { signer } = await getContract(i);
    trusteeSigners.push(signer);
  }

  const voting = caContract.connect(new ethers.NonceManager(caSigner));
  const submitVote = createVoteSubmitter(voting);

  const voterDb = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
  const voterSecrets = JSON.parse(fs.readFileSync(VOTER_SECRETS_FILE, "utf8"));

  const voterMap = new Map(
    voterDb.map((voter) => [String(voter.hashed_key), voter]),
  );
  const eligibleVoters = voterSecrets.filter((secret) =>
    voterMap.has(String(secret.hashed_key)),
  );

  const babyjub = await buildBabyjub();
  const poseidon = await buildPoseidon();

  const rootEntry = voterDb[0];
  if (!rootEntry || !rootEntry.root) {
    throw new Error("Merkle root not found. Please run prepare file first.");
  }
  const root = rootEntry.root.toString();
  const electionHash = hashElectionId(poseidon, ELECTION_ID);

  let submittedCount = 0;
  let failedCount = 0;
  let totalEndToEndTime = 0;
  let totalWitnessTime = 0;
  let totalProofTime = 0;

  try {
    for (
      let i = 0;
      i < Math.min(VOTES_TO_SIMULATE, eligibleVoters.length);
      i++
    ) {
      const voterSecret = eligibleVoters[i];
      const voterRecord = voterMap.get(String(voterSecret.hashed_key));
      const selectedChoices = pickRandomChoices(NUM_CANDIDATES, NUM_SELECTIONS);

      try {
        const startTime = performance.now();

        const { m, r, C1x, C1y, C2x, C2y } = await encryptVote(
          babyjub,
          publicKeyX,
          publicKeyY,
          NUM_CANDIDATES,
          selectedChoices,
        );

        const witnessInput = {
          sk: String(voterSecret.sk_bjj),
          pathElements: voterRecord.merkle_proof.path_elements,
          pathIndices: voterRecord.merkle_proof.path_indices,
          root,
          hash_pk: String(voterSecret.hashed_key),
          election_hash: electionHash,
          PKx: publicKeyX.toString(),
          PKy: publicKeyY.toString(),
          r,
          m,
          C1x,
          C1y,
          C2x,
          C2y,
        };

        const {
          proof,
          publicSignals,
          witnessTimeMs,
          proofGenerationTimeMs,
        } = await generateWitnessAndProof(
          witnessInput,
          voterSecret.hashed_key,
          i,
        );

        const cid = await uploadToIPFS(
          JSON.stringify({
            C1x,
            C1y,
            C2x,
            C2y,
          }),
        );

        const votePayload = buildVotePayload({
          nullifier: publicSignals[0],
          hashCipherAll: publicSignals[1],
          cid: `ipfs://${cid}`,
        });

        const packet = {
          proof,
          publicSignals,
          votePayload,
        };

        const signatures = [];

        for (const trusteeSigner of trusteeSigners) {
          const sig = await verifyAndSignByTrustee(
            trusteeSigner,
            caContract,
            vKey,
            packet,
          );

          signatures.push(sig);

          if (signatures.length >= THRESHOLD) {
            break;
          }
        }

        if (signatures.length < THRESHOLD) {
          throw new Error("Not enough trustee approvals");
        }

        const result = await submitVote(packet, signatures);

        const endTime = performance.now();
        const endToEndTimeMs = endTime - startTime;

        totalEndToEndTime += endToEndTimeMs;
        totalWitnessTime += witnessTimeMs;
        totalProofTime += proofGenerationTimeMs;

        appendCSVData({
          voter: String(voterSecret.hashed_key),
          mode: MODE,
          gasUsed: result.gasUsed.toString(),
          endToEndTimeMs: endToEndTimeMs.toFixed(2),
          witnessTimeMs: witnessTimeMs.toFixed(2),
          proofGenerationTimeMs: proofGenerationTimeMs.toFixed(2),
          resultCode: result.code,
        });

        if (result.code === 0) {
          voteWriter.addVote({
            election_id: ELECTION_ID,
            hashed_key: String(voterSecret.hashed_key),
            choices: selectedChoices,
            C1x,
            C1y,
            C2x,
            C2y,
            nullifier: String(publicSignals[0]),
            hashCipher: String(publicSignals[1]),
            ipfs_cid: `ipfs://${cid}`,
            gasUsed: result.gasUsed.toString(),
            endToEndTimeMs: endToEndTimeMs.toFixed(2),
            witnessTimeMs: witnessTimeMs.toFixed(2),
            proofGenerationTimeMs: proofGenerationTimeMs.toFixed(2),
          });

          submittedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        failedCount++;
        console.error(`Vote ${i + 1} failed: ${error.message}`);
      }
    }
  } finally {
    await voteWriter.close();
  }

  const averageEndToEnd =
    submittedCount > 0 ? totalEndToEndTime / submittedCount : 0;
  const averageWitness =
    submittedCount > 0 ? totalWitnessTime / submittedCount : 0;
  const averageProof =
    submittedCount > 0 ? totalProofTime / submittedCount : 0;

  console.log(`Average end-to-end time: ${averageEndToEnd.toFixed(2)} ms`);
  console.log(`Average witness time: ${averageWitness.toFixed(2)} ms`);
  console.log(`Average proof generation time: ${averageProof.toFixed(2)} ms`);
  console.log(
    `Voting finished. Submitted: ${submittedCount}, Failed: ${failedCount}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("Vote failed:", error);
  process.exit(1);
});

// const fs = require("fs");
// const path = require("path");
// const crypto = require("crypto");
// const { ethers } = require("hardhat");
// const snarkjs = require("snarkjs");
// const { groth16, wtns } = snarkjs;
// const { buildBabyjub, buildPoseidon } = require("circomlibjs");
// const { performance } = require("perf_hooks");

// const { getContract } = require("../configs/blockchain");
// const { uploadToIPFS } = require("../utils/ipfs");

// const VOTER_DB_FILE = path.join(
//   __dirname,
//   "../data/voter_data_for_db_100000.json",
// );
// const VOTER_SECRETS_FILE = path.join(
//   __dirname,
//   "../data/voter_secrets_for_script_100000.json",
// );
// const DKG_PUBLIC_KEY_PATH = path.join(
//   __dirname,
//   "../data/dkgKeys/public_key.json",
// );

// const WASM_PATH = path.join(
//   __dirname,
//   "../circuits/build/VoteProofCombined/VoteProofCombined_js/VoteProofCombined.wasm",
// );
// const ZKEY_PATH = path.join(
//   __dirname,
//   "../circuits/build/VoteProofCombined/VoteProofCombined.zkey",
// );
// const VKEY_PATH = path.join(
//   __dirname,
//   "../circuits/build/VoteProofCombined/VoteProofCombined_vkey.json",
// );

// const VOTE_OUT_FILE = path.join(__dirname, "../data/vote.json");
// const CSV_FILE = path.join(__dirname, "../data/vote_submission_times.csv");
// const WITNESS_DIR = path.join(__dirname, "../data/tmp_witness");

// const MODE = "C";

// const ELECTION_ID = "ELC2026";
// const NUM_CANDIDATES = 2;
// const NUM_SELECTIONS = 1;
// const VOTES_TO_SIMULATE = 1000;
// const VOTE_BATCH_SIZE = 2000;

// function ensureDir(dirPath) {
//   if (!fs.existsSync(dirPath)) {
//     fs.mkdirSync(dirPath, { recursive: true });
//   }
// }

// function createVoteWriter(filePath, batchSize = 1000) {
//   const stream = fs.createWriteStream(filePath, { flags: "w" });
//   let buffer = [];
//   let isFirstVote = true;

//   stream.write("[\n");

//   function flush() {
//     if (buffer.length === 0) return;

//     let chunk = "";
//     for (const vote of buffer) {
//       if (!isFirstVote) chunk += ",\n";
//       chunk += JSON.stringify(vote, null, 2);
//       isFirstVote = false;
//     }

//     stream.write(chunk);
//     buffer = [];
//   }

//   return {
//     addVote(vote) {
//       buffer.push(vote);
//       if (buffer.length >= batchSize) flush();
//     },

//     async close() {
//       flush();
//       await new Promise((resolve, reject) => {
//         stream.on("error", reject);
//         stream.end("\n]\n", resolve);
//       });
//     },
//   };
// }

// function resetCSV() {
//   fs.writeFileSync(
//     CSV_FILE,
//     "voter,mode,gasUsed,endToEndTimeMs,witnessTimeMs,proofGenerationTimeMs,resultCode\n",
//     "utf8",
//   );
// }

// function appendCSVData(data) {
//   const row = [
//     data.voter,
//     data.mode,
//     data.gasUsed,
//     data.endToEndTimeMs,
//     data.witnessTimeMs,
//     data.proofGenerationTimeMs,
//     data.resultCode,
//   ].join(",") + "\n";

//   fs.appendFileSync(CSV_FILE, row, "utf8");
// }

// function hashElectionId(poseidon, value) {
//   const F = poseidon.F;
//   const chars = Array.from(value).map((char) => BigInt(char.charCodeAt(0)));
//   return F.toObject(poseidon(chars)).toString();
// }

// function pickRandomChoices(numCandidates, numSelections) {
//   if (numSelections > numCandidates) {
//     throw new Error("numSelections cannot be greater than numCandidates");
//   }

//   const indices = Array.from({ length: numCandidates }, (_, i) => i);

//   for (let i = indices.length - 1; i > 0; i--) {
//     const j = Math.floor(Math.random() * (i + 1));
//     [indices[i], indices[j]] = [indices[j], indices[i]];
//   }

//   return indices.slice(0, numSelections);
// }

// async function encryptVote(
//   babyjub,
//   publicKeyX,
//   publicKeyY,
//   numCandidates,
//   selectedChoices,
// ) {
//   const F = babyjub.F;
//   const G = babyjub.Base8;
//   const n = babyjub.subOrder;
//   const publicKey = [F.e(publicKeyX), F.e(publicKeyY)];

//   const messages = Array(numCandidates).fill(0n);
//   for (const idx of selectedChoices) {
//     if (idx < 0 || idx >= numCandidates) {
//       throw new Error(`Invalid selected choice index: ${idx}`);
//     }
//     messages[idx] = 1n;
//   }

//   const randomness = Array.from({ length: numCandidates }, () => {
//     const randomBytes = crypto.randomBytes(32);
//     return BigInt(`0x${randomBytes.toString("hex")}`) % n;
//   });

//   const C1x = [];
//   const C1y = [];
//   const C2x = [];
//   const C2y = [];

//   for (let i = 0; i < numCandidates; i++) {
//     const C1 = babyjub.mulPointEscalar(G, randomness[i]);
//     const rPK = babyjub.mulPointEscalar(publicKey, randomness[i]);
//     const mG = babyjub.mulPointEscalar(G, messages[i]);
//     const C2 = babyjub.addPoint(mG, rPK);

//     C1x.push(F.toObject(C1[0]).toString());
//     C1y.push(F.toObject(C1[1]).toString());
//     C2x.push(F.toObject(C2[0]).toString());
//     C2y.push(F.toObject(C2[1]).toString());
//   }

//   return {
//     m: messages.map(String),
//     r: randomness.map(String),
//     C1x,
//     C1y,
//     C2x,
//     C2y,
//   };
// }

// function buildVotePayload({ nullifier, hashCipherAll, cid }) {
//   return {
//     nullifier: ethers.zeroPadValue(ethers.toBeHex(BigInt(nullifier)), 32),
//     hashCipherAll: ethers.zeroPadValue(
//       ethers.toBeHex(BigInt(hashCipherAll)),
//       32,
//     ),
//     cid,
//   };
// }

// async function generateWitnessAndProof(witnessInput, voterId, index) {
//   ensureDir(WITNESS_DIR);

//   const witnessFile = path.join(
//     WITNESS_DIR,
//     `vote_${index}_${String(voterId)}.wtns`,
//   );

//   const witnessStart = performance.now();
//   await wtns.calculate(witnessInput, WASM_PATH, witnessFile);
//   const witnessEnd = performance.now();
//   const witnessTimeMs = witnessEnd - witnessStart;

//   const proofStart = performance.now();
//   const { proof, publicSignals } = await groth16.prove(ZKEY_PATH, witnessFile);
//   const proofEnd = performance.now();
//   const proofGenerationTimeMs = proofEnd - proofStart;

//   try {
//     fs.unlinkSync(witnessFile);
//   } catch (_) {}

//   return {
//     proof,
//     publicSignals,
//     witnessTimeMs,
//     proofGenerationTimeMs,
//   };
// }

// async function verifyAndSignByTrustee(
//   trusteeSigner,
//   votingContract,
//   vKey,
//   packet,
// ) {
//   const isValid = await groth16.verify(
//     vKey,
//     packet.publicSignals,
//     packet.proof,
//   );
//   if (!isValid) {
//     throw new Error(
//       `Trustee ${await trusteeSigner.getAddress()} rejected invalid proof`,
//     );
//   }

//   const digest = await votingContract
//     .connect(trusteeSigner)
//     .getVoteApprovalDigest(
//       packet.votePayload.nullifier,
//       packet.votePayload.hashCipherAll,
//       packet.votePayload.cid,
//     );

//   const signature = await trusteeSigner.signMessage(ethers.getBytes(digest));
//   return signature;
// }

// function createVoteSubmitter(votingContract) {
//   const seen = new Set();

//   return async function submitVoteWithThreshold(packet, sig1, sig2) {
//     const key = `${packet.votePayload.nullifier}`;
//     if (seen.has(key)) {
//       return { code: 2, gasUsed: 0n };
//     }

//     const tx = await votingContract.submitVoteWithTrusteeSignatures(
//       packet.votePayload.nullifier,
//       packet.votePayload.hashCipherAll,
//       packet.votePayload.cid,
//       sig1,
//       sig2,
//     );

//     const receipt = await tx.wait();
//     seen.add(key);

//     return {
//       code: 0,
//       gasUsed: receipt.gasUsed ?? 0n,
//     };
//   };
// }

// async function main() {
//   if (!fs.existsSync(DKG_PUBLIC_KEY_PATH)) {
//     throw new Error("public_key.json not found. Run register.js first.");
//   }

//   if (!fs.existsSync(VKEY_PATH)) {
//     throw new Error("VoteProofCombined_vkey.json not found.");
//   }

//   ensureDir(WITNESS_DIR);

//   const publicKeyData = JSON.parse(
//     fs.readFileSync(DKG_PUBLIC_KEY_PATH, "utf8"),
//   );
//   const publicKeyX = BigInt(publicKeyData.x);
//   const publicKeyY = BigInt(publicKeyData.y);
//   const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

//   const voteWriter = createVoteWriter(VOTE_OUT_FILE, VOTE_BATCH_SIZE);
//   resetCSV();

//   const { votingContract: caContract, signer: caSigner } = await getContract(0);
//   const { signer: trustee1 } = await getContract(1);
//   const { signer: trustee2 } = await getContract(2);

//   const voting = caContract.connect(new ethers.NonceManager(caSigner));
//   const submitVote = createVoteSubmitter(voting);

//   const voterDb = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
//   const voterSecrets = JSON.parse(fs.readFileSync(VOTER_SECRETS_FILE, "utf8"));

//   const voterMap = new Map(
//     voterDb.map((voter) => [String(voter.hashed_key), voter]),
//   );
//   const eligibleVoters = voterSecrets.filter((secret) =>
//     voterMap.has(String(secret.hashed_key)),
//   );

//   const babyjub = await buildBabyjub();
//   const poseidon = await buildPoseidon();

//   const rootEntry = voterDb[0];
//   if (!rootEntry || !rootEntry.root) {
//     throw new Error("Merkle root not found. Please run prepare file first.");
//   }
//   const root = rootEntry.root.toString();
//   const electionHash = hashElectionId(poseidon, ELECTION_ID);

//   let submittedCount = 0;
//   let failedCount = 0;
//   let totalEndToEndTime = 0;
//   let totalWitnessTime = 0;
//   let totalProofTime = 0;

//   try {
//     for (
//       let i = 0;
//       i < Math.min(VOTES_TO_SIMULATE, eligibleVoters.length);
//       i++
//     ) {
//       const voterSecret = eligibleVoters[i];
//       const voterRecord = voterMap.get(String(voterSecret.hashed_key));
//       const selectedChoices = pickRandomChoices(NUM_CANDIDATES, NUM_SELECTIONS);

//       try {
//         const startTime = performance.now();

//         const { m, r, C1x, C1y, C2x, C2y } = await encryptVote(
//           babyjub,
//           publicKeyX,
//           publicKeyY,
//           NUM_CANDIDATES,
//           selectedChoices,
//         );

//         const witnessInput = {
//           sk: String(voterSecret.sk_bjj),
//           pathElements: voterRecord.merkle_proof.path_elements,
//           pathIndices: voterRecord.merkle_proof.path_indices,
//           root,
//           hash_pk: String(voterSecret.hashed_key),
//           election_hash: electionHash,
//           PKx: publicKeyX.toString(),
//           PKy: publicKeyY.toString(),
//           r,
//           m,
//           C1x,
//           C1y,
//           C2x,
//           C2y,
//         };

//         const {
//           proof,
//           publicSignals,
//           witnessTimeMs,
//           proofGenerationTimeMs,
//         } = await generateWitnessAndProof(
//           witnessInput,
//           voterSecret.hashed_key,
//           i,
//         );

//         const cid = await uploadToIPFS(
//           JSON.stringify({
//             C1x,
//             C1y,
//             C2x,
//             C2y,
//           }),
//         );

//         const votePayload = buildVotePayload({
//           nullifier: publicSignals[0],
//           hashCipherAll: publicSignals[1],
//           cid: `ipfs://${cid}`,
//         });

//         const packet = {
//           proof,
//           publicSignals,
//           votePayload,
//         };

//         const sig1 = await verifyAndSignByTrustee(
//           trustee1,
//           caContract,
//           vKey,
//           packet,
//         );
//         const sig2 = await verifyAndSignByTrustee(
//           trustee2,
//           caContract,
//           vKey,
//           packet,
//         );

//         const result = await submitVote(packet, sig1, sig2);

//         const endTime = performance.now();
//         const endToEndTimeMs = endTime - startTime;

//         totalEndToEndTime += endToEndTimeMs;
//         totalWitnessTime += witnessTimeMs;
//         totalProofTime += proofGenerationTimeMs;

//         appendCSVData({
//           voter: String(voterSecret.hashed_key),
//           mode: MODE,
//           gasUsed: result.gasUsed.toString(),
//           endToEndTimeMs: endToEndTimeMs.toFixed(2),
//           witnessTimeMs: witnessTimeMs.toFixed(2),
//           proofGenerationTimeMs: proofGenerationTimeMs.toFixed(2),
//           resultCode: result.code,
//         });

//         if (result.code === 0) {
//           voteWriter.addVote({
//             election_id: ELECTION_ID,
//             hashed_key: String(voterSecret.hashed_key),
//             choices: selectedChoices,
//             C1x,
//             C1y,
//             C2x,
//             C2y,
//             nullifier: String(publicSignals[0]),
//             hashCipher: String(publicSignals[1]),
//             ipfs_cid: `ipfs://${cid}`,
//             gasUsed: result.gasUsed.toString(),
//             endToEndTimeMs: endToEndTimeMs.toFixed(2),
//             witnessTimeMs: witnessTimeMs.toFixed(2),
//             proofGenerationTimeMs: proofGenerationTimeMs.toFixed(2),
//           });

//           submittedCount++;
//         } else {
//           failedCount++;
//         }
//       } catch (error) {
//         failedCount++;
//         console.error(`Vote ${i + 1} failed: ${error.message}`);
//       }
//     }
//   } finally {
//     await voteWriter.close();
//   }

//   const averageEndToEnd =
//     submittedCount > 0 ? totalEndToEndTime / submittedCount : 0;
//   const averageWitness =
//     submittedCount > 0 ? totalWitnessTime / submittedCount : 0;
//   const averageProof =
//     submittedCount > 0 ? totalProofTime / submittedCount : 0;

//   console.log(
//     `Average end-to-end time: ${averageEndToEnd.toFixed(2)} ms`,
//   );
//   console.log(`Average witness time: ${averageWitness.toFixed(2)} ms`);
//   console.log(
//     `Average proof generation time: ${averageProof.toFixed(2)} ms`,
//   );
//   console.log(
//     `Voting finished. Submitted: ${submittedCount}, Failed: ${failedCount}`,
//   );
//   process.exit(0);
// }

// main().catch((error) => {
//   console.error("Vote failed:", error);
//   process.exit(1);
// });

// // const fs = require("fs");
// // const path = require("path");
// // const crypto = require("crypto");
// // const { ethers } = require("hardhat");
// // const { groth16 } = require("snarkjs");
// // const { buildBabyjub, buildPoseidon } = require("circomlibjs");
// // const { performance } = require("perf_hooks");

// // const { getContract } = require("../configs/blockchain");
// // const { uploadToIPFS } = require("../utils/ipfs");

// // const VOTER_DB_FILE = path.join(
// //   __dirname,
// //   "../data/voter_data_for_db_100000.json",
// // );
// // const VOTER_SECRETS_FILE = path.join(
// //   __dirname,
// //   "../data/voter_secrets_for_script_100000.json",
// // );
// // const DKG_PUBLIC_KEY_PATH = path.join(
// //   __dirname,
// //   "../data/dkgKeys/public_key.json",
// // );

// // const WASM_PATH = path.join(
// //   __dirname,
// //   "../circuits/build/VoteProofCombined/VoteProofCombined_js/VoteProofCombined.wasm",
// // );
// // const ZKEY_PATH = path.join(
// //   __dirname,
// //   "../circuits/build/VoteProofCombined/VoteProofCombined.zkey",
// // );
// // const VKEY_PATH = path.join(
// //   __dirname,
// //   "../circuits/build/VoteProofCombined/VoteProofCombined_vkey.json",
// // );

// // const VOTE_OUT_FILE = path.join(__dirname, "../data/vote.json");
// // const CSV_FILE = path.join(__dirname, "../data/vote_submission_times.csv");

// // const ELECTION_ID = "ELC2026";
// // const NUM_CANDIDATES = 2;
// // const NUM_SELECTIONS = 1;
// // const VOTES_TO_SIMULATE = 1000;
// // const VOTE_BATCH_SIZE = 2000;

// // function createVoteWriter(filePath, batchSize = 1000) {
// //   const stream = fs.createWriteStream(filePath, { flags: "w" });
// //   let buffer = [];
// //   let isFirstVote = true;

// //   stream.write("[\n");

// //   function flush() {
// //     if (buffer.length === 0) return;

// //     let chunk = "";
// //     for (const vote of buffer) {
// //       if (!isFirstVote) chunk += ",\n";
// //       chunk += JSON.stringify(vote, null, 2);
// //       isFirstVote = false;
// //     }

// //     stream.write(chunk);
// //     buffer = [];
// //   }

// //   return {
// //     addVote(vote) {
// //       buffer.push(vote);
// //       if (buffer.length >= batchSize) flush();
// //     },

// //     async close() {
// //       flush();
// //       await new Promise((resolve, reject) => {
// //         stream.on("error", reject);
// //         stream.end("\n]\n", resolve);
// //       });
// //     },
// //   };
// // }

// // function resetCSV() {
// //   fs.writeFileSync(CSV_FILE, "voter,submittedTime(ms),resultCode\n", "utf8");
// // }

// // function appendCSVData(data) {
// //   const row = `${data.voter},${data.submittedTime},${data.resultCode}\n`;
// //   fs.appendFileSync(CSV_FILE, row, "utf8");
// // }

// // function hashElectionId(poseidon, value) {
// //   const F = poseidon.F;
// //   const chars = Array.from(value).map((char) => BigInt(char.charCodeAt(0)));
// //   return F.toObject(poseidon(chars)).toString();
// // }

// // function pickRandomChoices(numCandidates, numSelections) {
// //   if (numSelections > numCandidates) {
// //     throw new Error("numSelections cannot be greater than numCandidates");
// //   }

// //   const indices = Array.from({ length: numCandidates }, (_, i) => i);

// //   for (let i = indices.length - 1; i > 0; i--) {
// //     const j = Math.floor(Math.random() * (i + 1));
// //     [indices[i], indices[j]] = [indices[j], indices[i]];
// //   }

// //   return indices.slice(0, numSelections);
// // }

// // async function encryptVote(
// //   babyjub,
// //   publicKeyX,
// //   publicKeyY,
// //   numCandidates,
// //   selectedChoices,
// // ) {
// //   const F = babyjub.F;
// //   const G = babyjub.Base8;
// //   const n = babyjub.subOrder;
// //   const publicKey = [F.e(publicKeyX), F.e(publicKeyY)];

// //   const messages = Array(numCandidates).fill(0n);
// //   for (const idx of selectedChoices) {
// //     if (idx < 0 || idx >= numCandidates) {
// //       throw new Error(`Invalid selected choice index: ${idx}`);
// //     }
// //     messages[idx] = 1n;
// //   }

// //   const randomness = Array.from({ length: numCandidates }, () => {
// //     const randomBytes = crypto.randomBytes(32);
// //     return BigInt(`0x${randomBytes.toString("hex")}`) % n;
// //   });

// //   const C1x = [];
// //   const C1y = [];
// //   const C2x = [];
// //   const C2y = [];

// //   for (let i = 0; i < numCandidates; i++) {
// //     const C1 = babyjub.mulPointEscalar(G, randomness[i]);
// //     const rPK = babyjub.mulPointEscalar(publicKey, randomness[i]);
// //     const mG = babyjub.mulPointEscalar(G, messages[i]);
// //     const C2 = babyjub.addPoint(mG, rPK);

// //     C1x.push(F.toObject(C1[0]).toString());
// //     C1y.push(F.toObject(C1[1]).toString());
// //     C2x.push(F.toObject(C2[0]).toString());
// //     C2y.push(F.toObject(C2[1]).toString());
// //   }

// //   return {
// //     m: messages.map(String),
// //     r: randomness.map(String),
// //     C1x,
// //     C1y,
// //     C2x,
// //     C2y,
// //   };
// // }

// // function buildVotePayload({ nullifier, hashCipherAll, cid }) {
// //   return {
// //     nullifier: ethers.zeroPadValue(ethers.toBeHex(BigInt(nullifier)), 32),
// //     hashCipherAll: ethers.zeroPadValue(
// //       ethers.toBeHex(BigInt(hashCipherAll)),
// //       32,
// //     ),
// //     cid,
// //   };
// // }

// // async function verifyAndSignByTrustee(
// //   trusteeSigner,
// //   votingContract,
// //   vKey,
// //   packet,
// // ) {
// //   const isValid = await groth16.verify(
// //     vKey,
// //     packet.publicSignals,
// //     packet.proof,
// //   );
// //   if (!isValid) {
// //     throw new Error(
// //       `Trustee ${await trusteeSigner.getAddress()} rejected invalid proof`,
// //     );
// //   }

// //   const digest = await votingContract
// //     .connect(trusteeSigner)
// //     .getVoteApprovalDigest(
// //       packet.votePayload.nullifier,
// //       packet.votePayload.hashCipherAll,
// //       packet.votePayload.cid,
// //     );

// //   const signature = await trusteeSigner.signMessage(ethers.getBytes(digest));
// //   return signature;
// // }

// // function createVoteSubmitter(votingContract) {
// //   const seen = new Set();

// //   return async function submitVoteWithThreshold(packet, sig1, sig2) {
// //     const key = `${packet.votePayload.nullifier}`;
// //     if (seen.has(key)) return { code: 2 };

// //     const tx = await votingContract.submitVoteWithTrusteeSignatures(
// //       packet.votePayload.nullifier,
// //       packet.votePayload.hashCipherAll,
// //       packet.votePayload.cid,
// //       sig1,
// //       sig2,
// //     );

// //     await tx.wait();
// //     seen.add(key);
// //     return { code: 0 };
// //   };
// // }

// // async function main() {
// //   if (!fs.existsSync(DKG_PUBLIC_KEY_PATH)) {
// //     throw new Error("public_key.json not found. Run register.js first.");
// //   }

// //   if (!fs.existsSync(VKEY_PATH)) {
// //     throw new Error("VoteProofCombined_vkey.json not found.");
// //   }

// //   const publicKeyData = JSON.parse(
// //     fs.readFileSync(DKG_PUBLIC_KEY_PATH, "utf8"),
// //   );
// //   const publicKeyX = BigInt(publicKeyData.x);
// //   const publicKeyY = BigInt(publicKeyData.y);
// //   const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

// //   const voteWriter = createVoteWriter(VOTE_OUT_FILE, VOTE_BATCH_SIZE);
// //   resetCSV();

// //   const { votingContract: caContract, signer: caSigner } = await getContract(0);
// //   const { signer: trustee1 } = await getContract(1);
// //   const { signer: trustee2 } = await getContract(2);

// //   const voting = caContract.connect(new ethers.NonceManager(caSigner));
// //   const submitVote = createVoteSubmitter(voting);

// //   const voterDb = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
// //   const voterSecrets = JSON.parse(fs.readFileSync(VOTER_SECRETS_FILE, "utf8"));

// //   const voterMap = new Map(
// //     voterDb.map((voter) => [String(voter.hashed_key), voter]),
// //   );
// //   const eligibleVoters = voterSecrets.filter((secret) =>
// //     voterMap.has(String(secret.hashed_key)),
// //   );

// //   const babyjub = await buildBabyjub();
// //   const poseidon = await buildPoseidon();

// //   const rootEntry = voterDb[0];
// //   if (!rootEntry || !rootEntry.root) {
// //     throw new Error("Merkle root not found. Please run prepare file first.");
// //   }
// //   const root = rootEntry.root.toString();
// //   const electionHash = hashElectionId(poseidon, ELECTION_ID);

// //   let submittedCount = 0;
// //   let failedCount = 0;
// //   let totalSubmissionTime = 0;

// //   try {
// //     for (
// //       let i = 0;
// //       i < Math.min(VOTES_TO_SIMULATE, eligibleVoters.length);
// //       i++
// //     ) {
// //       const voterSecret = eligibleVoters[i];
// //       const voterRecord = voterMap.get(String(voterSecret.hashed_key));
// //       const selectedChoices = pickRandomChoices(NUM_CANDIDATES, NUM_SELECTIONS);

// //       try {
// //         const startTime = performance.now();

// //         const { m, r, C1x, C1y, C2x, C2y } = await encryptVote(
// //           babyjub,
// //           publicKeyX,
// //           publicKeyY,
// //           NUM_CANDIDATES,
// //           selectedChoices,
// //         );

// //         const witnessInput = {
// //           sk: String(voterSecret.sk_bjj),
// //           pathElements: voterRecord.merkle_proof.path_elements,
// //           pathIndices: voterRecord.merkle_proof.path_indices,
// //           root,
// //           hash_pk: String(voterSecret.hashed_key),
// //           election_hash: electionHash,
// //           PKx: publicKeyX.toString(),
// //           PKy: publicKeyY.toString(),
// //           r,
// //           m,
// //           C1x,
// //           C1y,
// //           C2x,
// //           C2y,
// //         };

// //         const { proof, publicSignals } = await groth16.fullProve(
// //           witnessInput,
// //           WASM_PATH,
// //           ZKEY_PATH,
// //         );

// //         const cid = await uploadToIPFS(
// //           JSON.stringify({
// //             C1x,
// //             C1y,
// //             C2x,
// //             C2y,
// //           }),
// //         );

// //         const votePayload = buildVotePayload({
// //           nullifier: publicSignals[0],
// //           hashCipherAll: publicSignals[1],
// //           cid: `ipfs://${cid}`,
// //         });

// //         const packet = {
// //           proof,
// //           publicSignals,
// //           votePayload,
// //         };

// //         const sig1 = await verifyAndSignByTrustee(
// //           trustee1,
// //           caContract,
// //           vKey,
// //           packet,
// //         );
// //         const sig2 = await verifyAndSignByTrustee(
// //           trustee2,
// //           caContract,
// //           vKey,
// //           packet,
// //         );

// //         const result = await submitVote(packet, sig1, sig2);

// //         const endTime = performance.now();
// //         const submissionTime = endTime - startTime;
// //         totalSubmissionTime += submissionTime;

// //         appendCSVData({
// //           voter: String(voterSecret.hashed_key),
// //           submittedTime: submissionTime.toFixed(2),
// //           resultCode: result.code,
// //         });

// //         if (result.code === 0) {
// //           voteWriter.addVote({
// //             election_id: ELECTION_ID,
// //             hashed_key: String(voterSecret.hashed_key),
// //             choices: selectedChoices,
// //             C1x,
// //             C1y,
// //             C2x,
// //             C2y,
// //             nullifier: String(publicSignals[0]),
// //             hashCipher: String(publicSignals[1]),
// //             ipfs_cid: `ipfs://${cid}`,
// //           });

// //           submittedCount++;
// //         } else {
// //           failedCount++;
// //         }
// //       } catch (error) {
// //         failedCount++;
// //         console.error(`Vote ${i + 1} failed: ${error.message}`);
// //       }
// //     }
// //   } finally {
// //     await voteWriter.close();
// //   }

// //   const averageSubmissionTime =
// //     submittedCount > 0 ? totalSubmissionTime / submittedCount : 0;

// //   console.log(
// //     `Average submission time: ${averageSubmissionTime.toFixed(2)} ms`,
// //   );
// //   console.log(
// //     `Voting finished. Submitted: ${submittedCount}, Failed: ${failedCount}`,
// //   );
// //   process.exit(0);
// // }

// // main().catch((error) => {
// //   console.error("Vote failed:", error);
// //   process.exit(1);
// // });
