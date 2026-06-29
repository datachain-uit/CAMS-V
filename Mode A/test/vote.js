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
  "../data/voter_data_for_db_500000.json",
);
const VOTER_SECRETS_FILE = path.join(
  __dirname,
  "../data/voter_secrets_for_script_500000.json",
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

const MODE = "A";

const ELECTION_ID = "ELC2026";
const NUM_CANDIDATES = 2;
const NUM_SELECTIONS = 1;
const VOTES_TO_SIMULATE = 10;
const VOTE_BATCH_SIZE = 2000;

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
      if (buffer.length >= batchSize) {
        flush();
      }
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
  const header =
    "voter,mode,gasUsed,endToEndTimeMs,witnessTimeMs,proofGenerationTimeMs,resultCode\n";
  fs.writeFileSync(CSV_FILE, header, "utf8");
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

function toBytes32(value) {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 32);
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

function createVoteSubmitter(votingContract, vKey) {
  const seen = new Set();

  return async function submitVoteLocal(proof, publicSignals, voteData) {
    const isValid = await groth16.verify(vKey, publicSignals, proof);
    if (!isValid) {
      return { code: 1, gasUsed: 0n };
    }

    const key = `${voteData.election_id}|${voteData.nullifier}`;
    if (seen.has(key)) {
      return { code: 2, gasUsed: 0n };
    }

    seen.add(key);

    const tx = await votingContract.submitVote(
      toBytes32(voteData.nullifier),
      toBytes32(publicSignals[1]),
      voteData.ipfs_cid,
    );
    const receipt = await tx.wait();

    return {
      code: 0,
      gasUsed: receipt.gasUsed ?? 0n,
    };
  };
}

async function main() {
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

  const voteWriter = createVoteWriter(VOTE_OUT_FILE, VOTE_BATCH_SIZE);
  resetCSV();

  const { votingContract, signer } = await getContract();
  const voting = votingContract.connect(new ethers.NonceManager(signer));

  const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));
  const submitVoteLocal = createVoteSubmitter(voting, vKey);

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

        const voteData = {
          election_id: ELECTION_ID,
          nullifier: publicSignals[0],
        };

        const cid = await uploadToIPFS(
          JSON.stringify({
            C1x,
            C1y,
            C2x,
            C2y,
          }),
        );

        voteData.ipfs_cid = `ipfs://${cid}`;

        const result = await submitVoteLocal(proof, publicSignals, voteData);

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
  console.log(
    `Average proof generation time: ${averageProof.toFixed(2)} ms`,
  );
  console.log(
    `Voting finished. Submitted: ${submittedCount}, Failed: ${failedCount}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("Vote failed:", error);
  process.exit(1);
});

// Full voting simulation with zk proof generation, verification, on-chain submission,
// and IPFS upload. Successful votes are written to vote.json using batched streaming
// to avoid full-file rewrite overhead during large-scale experiments.

// const fs = require("fs");
// const path = require("path");
// const crypto = require("crypto");
// const { ethers } = require("hardhat");
// const { groth16 } = require("snarkjs");
// const { buildBabyjub, buildPoseidon } = require("circomlibjs");
// const { performance } = require("perf_hooks");

// const { getContract } = require("../configs/blockchain");
// const { uploadToIPFS } = require("../utils/ipfs");

// const VOTER_DB_FILE = path.join(
//   __dirname,
//   "../data/voter_data_for_db_500000.json",
// );
// const VOTER_SECRETS_FILE = path.join(
//   __dirname,
//   "../data/voter_secrets_for_script_500000.json",
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

// const ELECTION_ID = "ELC2026";
// const NUM_CANDIDATES = 15;
// const NUM_SELECTIONS = 10;
// const VOTES_TO_SIMULATE = 10;
// const VOTE_BATCH_SIZE = 2;

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
//       if (buffer.length >= batchSize) {
//         flush();
//       }
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
//   const header = "voter,submittedTime(ms),resultCode\n";
//   fs.writeFileSync(CSV_FILE, header, "utf8");
// }

// function appendCSVData(data) {
//   const row = `${data.voter},${data.submittedTime},${data.resultCode}\n`;
//   fs.appendFileSync(CSV_FILE, row, "utf8");
// }

// function toBytes32(value) {
//   return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 32);
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

// function createVoteSubmitter(votingContract, vKey) {
//   const seen = new Set();

//   return async function submitVoteLocal(proof, publicSignals, voteData) {
//     const isValid = await groth16.verify(vKey, publicSignals, proof);
//     if (!isValid) {
//       return { code: 1 };
//     }

//     const key = `${voteData.election_id}|${voteData.nullifier}`;
//     if (seen.has(key)) {
//       return { code: 2 };
//     }

//     seen.add(key);

//     const tx = await votingContract.submitVote(
//       toBytes32(voteData.nullifier),
//       toBytes32(publicSignals[1]),
//       voteData.ipfs_cid,
//     );
//     await tx.wait();

//     return { code: 0 };
//   };
// }

// async function main() {
//   if (!fs.existsSync(DKG_PUBLIC_KEY_PATH)) {
//     throw new Error("public_key.json not found. Run register.js first.");
//   }

//   const publicKeyData = JSON.parse(
//     fs.readFileSync(DKG_PUBLIC_KEY_PATH, "utf8"),
//   );
//   const publicKeyX = BigInt(publicKeyData.x);
//   const publicKeyY = BigInt(publicKeyData.y);

//   const voteWriter = createVoteWriter(VOTE_OUT_FILE, VOTE_BATCH_SIZE);
//   resetCSV();

//   const { votingContract, signer } = await getContract();
//   const voting = votingContract.connect(new ethers.NonceManager(signer));

//   const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));
//   const submitVoteLocal = createVoteSubmitter(voting, vKey);

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
//   let totalSubmissionTime = 0;

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

//         const { proof, publicSignals } = await groth16.fullProve(
//           witnessInput,
//           WASM_PATH,
//           ZKEY_PATH,
//         );

//         const voteData = {
//           election_id: ELECTION_ID,
//           nullifier: publicSignals[0],
//         };

//         const cid = await uploadToIPFS(
//           JSON.stringify({
//             C1x,
//             C1y,
//             C2x,
//             C2y,
//           }),
//         );

//         voteData.ipfs_cid = `ipfs://${cid}`;

//         const result = await submitVoteLocal(proof, publicSignals, voteData);
//         const endTime = performance.now();

//         const submissionTime = endTime - startTime;
//         totalSubmissionTime += submissionTime;

//         appendCSVData({
//           voter: String(voterSecret.hashed_key),
//           submittedTime: submissionTime.toFixed(2),
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

//   const averageSubmissionTime =
//     submittedCount > 0 ? totalSubmissionTime / submittedCount : 0;

//   console.log(
//     `Average submission time: ${averageSubmissionTime.toFixed(2)} ms`,
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

// Fast voting simulation for performance benchmarking.
// This version skips zk proof generation/verification and submits votes directly,
// while still encrypting ballots and storing successful vote records in batched JSON output.

// const fs = require("fs");
// const path = require("path");
// const crypto = require("crypto");
// const { ethers } = require("hardhat");
// const { buildBabyjub, buildPoseidon } = require("circomlibjs");
// const { performance } = require("perf_hooks");

// const { getContract } = require("../configs/blockchain");
// const { uploadToIPFS } = require("../utils/ipfs");

// const VOTER_DB_FILE = path.join(
//   __dirname,
//   "../data/voter_data_for_db_500000.json"
// );
// const VOTER_SECRETS_FILE = path.join(
//   __dirname,
//   "../data/voter_secrets_for_script_500000.json"
// );
// const DKG_PUBLIC_KEY_PATH = path.join(
//   __dirname,
//   "../data/dkgKeys/public_key.json"
// );

// const VOTE_OUT_FILE = path.join(__dirname, "../data/vote.json");
// const CSV_FILE = path.join(__dirname, "../data/vote_submission_times.csv");

// const ELECTION_ID = "ELC2026";
// const NUM_CANDIDATES = 10;
// const NUM_SELECTIONS = 2;
// const VOTES_TO_SIMULATE = 10000;
// const VOTE_BATCH_SIZE = 2000;

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
//       if (buffer.length >= batchSize) {
//         flush();
//       }
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
//   const header = "voter,submittedTime(ms),resultCode\n";
//   fs.writeFileSync(CSV_FILE, header, "utf8");
// }

// function appendCSVData(data) {
//   const row = `${data.voter},${data.submittedTime},${data.resultCode}\n`;
//   fs.appendFileSync(CSV_FILE, row, "utf8");
// }

// function toBytes32(value) {
//   return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 32);
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
//   selectedChoices
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

// function calculateHashCipher(poseidon, C1x, C1y, C2x, C2y) {
//   let acc = 0n;
//   const nCandidates = C1x.length;

//   for (let i = 0; i < nCandidates; i++) {
//     const h = poseidon([
//       BigInt(C1x[i]),
//       BigInt(C1y[i]),
//       BigInt(C2x[i]),
//       BigInt(C2y[i]),
//     ]);

//     acc = poseidon([acc, h]);
//   }

//   return poseidon.F.toObject(acc).toString();
// }

// function createVoteSubmitter(votingContract) {
//   const seen = new Set();

//   return async function submitVoteLocal(voteData) {
//     const key = `${voteData.election_id}|${voteData.nullifier}`;
//     if (seen.has(key)) {
//       return { code: 2 };
//     }

//     seen.add(key);

//     const tx = await votingContract.submitVote(
//       toBytes32(voteData.nullifier),
//       toBytes32(voteData.hashCipher),
//       voteData.ipfs_cid
//     );
//     await tx.wait();

//     return { code: 0 };
//   };
// }

// async function main() {
//   if (!fs.existsSync(DKG_PUBLIC_KEY_PATH)) {
//     throw new Error("public_key.json not found. Run register.js first.");
//   }

//   const publicKeyData = JSON.parse(
//     fs.readFileSync(DKG_PUBLIC_KEY_PATH, "utf8")
//   );
//   const publicKeyX = BigInt(publicKeyData.x);
//   const publicKeyY = BigInt(publicKeyData.y);

//   resetCSV();
//   const voteWriter = createVoteWriter(VOTE_OUT_FILE, VOTE_BATCH_SIZE);

//   const { votingContract, signer } = await getContract();
//   const voting = votingContract.connect(new ethers.NonceManager(signer));

//   const voterDb = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
//   const voterSecrets = JSON.parse(fs.readFileSync(VOTER_SECRETS_FILE, "utf8"));

//   const voterMap = new Map(
//     voterDb.map((voter) => [String(voter.hashed_key), voter])
//   );
//   const eligibleVoters = voterSecrets.filter((secret) =>
//     voterMap.has(String(secret.hashed_key))
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
//   let totalSubmissionTime = 0;

//   for (let i = 0; i < Math.min(VOTES_TO_SIMULATE, eligibleVoters.length); i++) {
//     const voterSecret = eligibleVoters[i];
//     const voterRecord = voterMap.get(String(voterSecret.hashed_key));
//     const selectedChoices = pickRandomChoices(NUM_CANDIDATES, NUM_SELECTIONS);

//     try {
//       const startTime = performance.now();

//       const { m, r, C1x, C1y, C2x, C2y } = await encryptVote(
//         babyjub,
//         publicKeyX,
//         publicKeyY,
//         NUM_CANDIDATES,
//         selectedChoices
//       );

//       const hashCipher = calculateHashCipher(poseidon, C1x, C1y, C2x, C2y);
//       const nullifier = voterSecret.nullifier;

//       const nullifierBytes32 = ethers.zeroPadValue(
//         ethers.toBeHex(BigInt(nullifier)),
//         32
//       );
//       const hashCipherBytes32 = ethers.zeroPadValue(
//         ethers.toBeHex(BigInt(hashCipher)),
//         32
//       );

//       const voteData = {
//         election_id: ELECTION_ID,
//         nullifier: nullifierBytes32,
//         hashCipher: hashCipherBytes32,
//         ipfs_cid: "123",
//       };

//       const result = await createVoteSubmitter(voting)(voteData);
//       const endTime = performance.now();

//       const submissionTime = endTime - startTime;
//       totalSubmissionTime += submissionTime;

//       appendCSVData({
//         voter: String(voterSecret.hashed_key),
//         submittedTime: submissionTime.toFixed(2),
//         resultCode: result.code,
//       });

//       if (result.code === 0) {
//         voteWriter.addVote({
//           election_id: ELECTION_ID,
//           hashed_key: String(voterSecret.hashed_key),
//           choices: selectedChoices,
//           C1x,
//           C1y,
//           C2x,
//           C2y,
//           nullifier: String(voteData.nullifier),
//           hashCipher: String(voteData.hashCipher),
//           ipfs_cid: `ipfs://${"123"}`,
//         });

//         submittedCount++;
//       } else {
//         failedCount++;
//       }
//     } catch (error) {
//       failedCount++;
//       console.error(`Vote ${i + 1} failed: ${error.message}`);
//     }
//   }

//   await voteWriter.close();

//   const averageSubmissionTime =
//     submittedCount > 0 ? totalSubmissionTime / submittedCount : 0;

//   console.log(
//     `Average submission time: ${averageSubmissionTime.toFixed(2)} ms`
//   );
//   console.log(
//     `Voting finished. Submitted: ${submittedCount}, Failed: ${failedCount}`
//   );
//   process.exit(0);
// }

// main().catch((error) => {
//   console.error("Vote failed:", error);
//   process.exit(1);
// });