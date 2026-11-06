const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const { performance } = require("perf_hooks");
const { getContract } = require("../configs/blockchain");
const { uploadToIPFS } = require("../utils/ipfs");

const {
  ensureDir,
  createVoteWriter,
  resetCSV,
  appendCSVData,
} = require("./vote_modules/output");

const {
  hashElectionId,
  pickRandomChoices,
  encryptVote,
  buildVotePayload,
} = require("./vote_modules/ballot");

const { generateWitnessAndProof } = require("./vote_modules/proof");
const { createVoteSubmitter } = require("./vote_modules/submit");
const { collectApprovals } = require("./vote_modules/collector");
const { startWorkerPool } = require("./vote_modules/worker_pool");

const {
  prepareExperimentOutput,
  writeExperimentRow,
} = require("./vote_modules/experiment_output");

const experiment = require("./experiment.config");

const VOTER_DB_FILE = path.join(
  __dirname,
  "../data/voter_data_for_db_1000.json",
);

const VOTER_SECRETS_FILE = path.join(
  __dirname,
  "../data/voter_secrets_for_script_1000.json",
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

const EXPERIMENT_CSV_FILE = path.join(
  __dirname,
  "../data/mode_c_experiment.csv",
);

const WITNESS_DIR = path.join(__dirname, "../data/tmp_witness");

const MODE = "C";

const ELECTION_ID = "ELC2026";
const NUM_CANDIDATES = 2;
const NUM_SELECTIONS = 1;

const VOTES_TO_SIMULATE = 101;

const VOTE_BATCH_SIZE = 2000;

const TOTAL_TRUSTEES = 7;
const THRESHOLD = 4;

const DRAIN_TIMEOUT_MS = Math.max(30000, experiment.deadlineMs + 5000);

async function waitForTrusteesToDrain(approval, voteIndex) {
  if (!approval) return;

  if (!approval.drained || typeof approval.drained.then !== "function") {
    throw new Error("collector.js must return a drained Promise");
  }

  let timeoutId;

  try {
    await Promise.race([
      approval.drained,

      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Trustee drain timeout after ballot ${voteIndex}`));
        }, DRAIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// -------------------------------------------------------
// Main
// -------------------------------------------------------

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

  // Retained from the original code.
  const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

  const voterDb = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));

  const voterSecrets = JSON.parse(fs.readFileSync(VOTER_SECRETS_FILE, "utf8"));

  const voterMap = new Map(
    voterDb.map((voter) => [String(voter.hashed_key), voter]),
  );

  const eligibleVoters = voterSecrets.filter((secret) =>
    voterMap.has(String(secret.hashed_key)),
  );

  // Avoid silently running fewer ballots than requested.
  if (eligibleVoters.length < VOTES_TO_SIMULATE) {
    throw new Error(
      `Need ${VOTES_TO_SIMULATE} eligible voters, ` +
        `but only ${eligibleVoters.length} are available. ` +
        `Prepare enough registered voters first.`,
    );
  }

  const rootEntry = voterDb[0];

  if (!rootEntry || !rootEntry.root) {
    throw new Error("Merkle root not found. Please run prepare file first.");
  }

  const root = rootEntry.root.toString();

  const babyjub = await buildBabyjub();
  const poseidon = await buildPoseidon();

  const electionHash = hashElectionId(poseidon, ELECTION_ID);

  // Initialize outputs after basic input validation.
  const voteWriter = createVoteWriter(VOTE_OUT_FILE, VOTE_BATCH_SIZE);

  resetCSV(CSV_FILE);
  prepareExperimentOutput(EXPERIMENT_CSV_FILE);

  const { votingContract: caContract, signer: caSigner } = await getContract(0);

  // One independent process per trustee.
  const pool = await startWorkerPool({
    count: TOTAL_TRUSTEES,
    startupTimeoutMs: experiment.workerReadyTimeoutMs,
  });

  const voting = caContract.connect(new ethers.NonceManager(caSigner));

  const submitVote = createVoteSubmitter(voting);

  let submittedCount = 0;
  let failedCount = 0;

  let totalEndToEndTime = 0;
  let totalWitnessTime = 0;
  let totalProofTime = 0;

  try {
    // ---------------------------------------------------
    // Vote loop
    // ---------------------------------------------------

    for (let i = 0; i < VOTES_TO_SIMULATE; i++) {
      const voterSecret = eligibleVoters[i];

      const voterRecord = voterMap.get(String(voterSecret.hashed_key));

      const selectedChoices = pickRandomChoices(NUM_CANDIDATES, NUM_SELECTIONS);

      let startTime;

      let witnessTimeMs = 0;
      let proofGenerationTimeMs = 0;
      let ipfsTimeMs = 0;
      let onchainTimeMs = 0;

      // Must be declared OUTSIDE the inner try block,
      // so the finally block can access approval.drained.
      let approval = null;

      try {
        startTime = performance.now();

        // -----------------------------------------------
        // Stage 1: Prepare ballot and generate proof
        // -----------------------------------------------

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

          witnessTimeMs: measuredWitnessTime,
          proofGenerationTimeMs: measuredProofTime,
        } = await generateWitnessAndProof(
          witnessInput,
          voterSecret.hashed_key,
          i,
          {
            witnessDir: WITNESS_DIR,
            wasmPath: WASM_PATH,
            zkeyPath: ZKEY_PATH,
          },
        );

        witnessTimeMs = measuredWitnessTime;

        proofGenerationTimeMs = measuredProofTime;

        // -----------------------------------------------
        // Upload encrypted ballot to IPFS
        // -----------------------------------------------

        const ipfsStartedAt = performance.now();

        const cid = await uploadToIPFS(
          JSON.stringify({
            C1x,
            C1y,
            C2x,
            C2y,
          }),
        );

        ipfsTimeMs = performance.now() - ipfsStartedAt;

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

        // -----------------------------------------------
        // Stage 2: Concurrent trustee verification
        // -----------------------------------------------

        approval = await collectApprovals({
          pool,
          packet,

          threshold: THRESHOLD,

          config: experiment,
          voteIndex: i,
        });

        if (approval.status !== "THRESHOLD_REACHED") {
          throw new Error(`Approval ${approval.status}`);
        }

        const signatures = approval.signatures;

        // -----------------------------------------------
        // Stage 3: Submit ballot on-chain
        // -----------------------------------------------

        const onchainStartedAt = performance.now();

        const result = await submitVote(packet, signatures);

        onchainTimeMs = performance.now() - onchainStartedAt;

        // OAL ENDS HERE.
        // Outstanding trustee requests are NOT part
        // of this ballot's measured OAL.

        const endTime = performance.now();

        const endToEndTimeMs = endTime - startTime;

        totalEndToEndTime += endToEndTimeMs;
        totalWitnessTime += witnessTimeMs;
        totalProofTime += proofGenerationTimeMs;

        // -----------------------------------------------
        // Stage 4: Record performance metrics
        // -----------------------------------------------

        appendCSVData(
          {
            voter: String(voterSecret.hashed_key),

            mode: MODE,

            gasUsed: result.gasUsed.toString(),

            endToEndTimeMs: endToEndTimeMs.toFixed(2),

            witnessTimeMs: witnessTimeMs.toFixed(2),

            proofGenerationTimeMs: proofGenerationTimeMs.toFixed(2),

            resultCode: result.code,
          },
          CSV_FILE,
        );

        writeExperimentRow(EXPERIMENT_CSV_FILE, {
          scenarioId: experiment.scenarioId,

          voteIndex: i,

          voter: String(voterSecret.hashed_key),

          collectionMode: "MULTI_PROCESS_PARALLEL",

          threshold: THRESHOLD,

          totalTrustees: TOTAL_TRUSTEES,

          deadlineMs: experiment.deadlineMs,

          status: result.code === 0 ? "ACCEPTED" : "NOT_ACCEPTED",

          resultCode: result.code,

          gasUsed: result.gasUsed.toString(),

          timeToThresholdMs: approval.timeToThresholdMs,

          approvalElapsedMs: approval.approvalElapsedMs,

          endToEndTimeMs,

          witnessTimeMs,

          proofGenerationTimeMs,

          ipfsTimeMs,

          onchainTimeMs,

          trusteeDetails: approval.details || [],
        });

        // -----------------------------------------------
        // Record accepted ballot
        // -----------------------------------------------

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
        // -----------------------------------------------
        // Record failed ballot
        // -----------------------------------------------

        failedCount++;

        writeExperimentRow(EXPERIMENT_CSV_FILE, {
          scenarioId: experiment.scenarioId,

          voteIndex: i,

          voter: String(voterSecret.hashed_key),

          collectionMode: "MULTI_PROCESS_PARALLEL",

          threshold: THRESHOLD,

          totalTrustees: TOTAL_TRUSTEES,

          deadlineMs: experiment.deadlineMs,

          status: approval?.status || "ERROR",

          resultCode: 1,

          gasUsed: "",

          timeToThresholdMs: approval?.timeToThresholdMs,

          approvalElapsedMs: approval?.approvalElapsedMs,

          endToEndTimeMs:
            startTime == null ? "" : performance.now() - startTime,

          witnessTimeMs,

          proofGenerationTimeMs,

          ipfsTimeMs,

          onchainTimeMs,

          error: error.message,

          trusteeDetails: approval?.details || [],
        });

        console.error(`Vote ${i + 1} failed: ${error.message}`);
      } finally {
        // -----------------------------------------------
        // NEW: Trustee drain barrier
        // -----------------------------------------------
        //
        // Runs after successful/failed CSV logging.
        //
        // Do not include this waiting time in OAL.
        // Do not dispatch the next ballot until
        // all current trustee requests have settled.

        await waitForTrusteesToDrain(approval, i);
      }
    }
  } finally {
    // -----------------------------------------------
    // Cleanup
    // -----------------------------------------------

    for (const worker of pool) {
      worker.stop();
    }

    await voteWriter.close();
  }

  // ---------------------------------------------------
  // Summary
  // ---------------------------------------------------

  const averageEndToEnd =
    submittedCount > 0 ? totalEndToEndTime / submittedCount : 0;

  const averageWitness =
    submittedCount > 0 ? totalWitnessTime / submittedCount : 0;

  const averageProof = submittedCount > 0 ? totalProofTime / submittedCount : 0;

  console.log(`Average end-to-end time: ` + `${averageEndToEnd.toFixed(2)} ms`);

  console.log(`Average witness time: ` + `${averageWitness.toFixed(2)} ms`);

  console.log(
    `Average proof generation time: ` + `${averageProof.toFixed(2)} ms`,
  );

  console.log(
    `Voting finished. ` +
      `Submitted: ${submittedCount}, ` +
      `Failed: ${failedCount}`,
  );

  process.exit(0);
}

main().catch((error) => {
  console.error("Vote failed:", error);
  process.exit(1);
});
