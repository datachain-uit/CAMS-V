const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { buildPoseidon } = require("circomlibjs");

const merkleUtils = require("../utils/merkleUtils");

const OUTPUT_DIR = path.join(__dirname, "../data/merkle_metrics");
const HISTORY_CSV_FILE = path.join(OUTPUT_DIR, "merkle_prepare_history.csv");
const SUMMARY_JSON_FILE = path.join(OUTPUT_DIR, "merkle_prepare_summary.json");

const VOTER_SIZES = [1000, 10000, 20000, 40000, 60000, 80000, 100000];

function getVoterFilePath(nVoters) {
  return path.join(__dirname, `../data/voter_data_for_db_${nVoters}.json`);
}

function getLatestJsonPath(nVoters) {
  return path.join(OUTPUT_DIR, `merkle_prepare_${nVoters}.json`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function appendHistoryCSV(row) {
  const header = [
    "timestamp",
    "nVoters",
    "voterFile",
    "buildTreeTimeMs",
    "rootTimeMs",
    "totalProofGenTimeMs",
    "avgProofGenTimeMs",
    "writeFileTimeMs",
    "totalPrepareTimeMs",
    "pathLength",
  ].join(",");

  if (!fs.existsSync(HISTORY_CSV_FILE)) {
    fs.writeFileSync(HISTORY_CSV_FILE, `${header}\n`, "utf8");
  }

  const line = [
    row.timestamp,
    row.nVoters,
    JSON.stringify(row.voterFile),
    row.buildTreeTimeMs.toFixed(2),
    row.rootTimeMs.toFixed(2),
    row.totalProofGenTimeMs.toFixed(2),
    row.avgProofGenTimeMs.toFixed(6),
    row.writeFileTimeMs.toFixed(2),
    row.totalPrepareTimeMs.toFixed(2),
    row.pathLength,
  ].join(",");

  fs.appendFileSync(HISTORY_CSV_FILE, `${line}\n`, "utf8");
}

async function prepareOneFile(voterFile) {
  const totalStart = performance.now();

  if (!fs.existsSync(voterFile)) {
    throw new Error(`File not found: ${voterFile}`);
  }

  const rawData = JSON.parse(fs.readFileSync(voterFile, "utf8"));

  if (!Array.isArray(rawData) || rawData.length === 0) {
    throw new Error(`No voters found in file: ${voterFile}`);
  }

  const voters = rawData.filter(
    (item) => item && item.hashed_key !== undefined,
  );

  if (voters.length === 0) {
    throw new Error(`No valid voters with hashed_key found in: ${voterFile}`);
  }

  const poseidon = await buildPoseidon();
  const leaves = voters.map((voter) => BigInt(voter.hashed_key));

  const buildTreeStart = performance.now();
  const tree = merkleUtils.buildMerkleTree(poseidon, leaves);
  const buildTreeEnd = performance.now();
  const buildTreeTimeMs = buildTreeEnd - buildTreeStart;

  const rootStart = performance.now();
  const root = merkleUtils.getMerkleRoot(tree);
  const rootEnd = performance.now();
  const rootTimeMs = rootEnd - rootStart;

  const proofStart = performance.now();
  let pathLength = 0;

  voters.forEach((voter, index) => {
    const { pathElements, pathIndices } = merkleUtils.getMerkleProof(tree, index);

    if (index === 0) {
      pathLength = pathElements.length;
    }

    voter.merkle_proof = {
      path_elements: pathElements.map(String),
      path_indices: pathIndices.map(String),
    };
  });

  const proofEnd = performance.now();
  const totalProofGenTimeMs = proofEnd - proofStart;
  const avgProofGenTimeMs =
    voters.length > 0 ? totalProofGenTimeMs / voters.length : 0;

  const updatedVoters = [{ root: root.toString() }, ...voters];

  const writeStart = performance.now();
  fs.writeFileSync(voterFile, JSON.stringify(updatedVoters, null, 2), "utf8");
  const writeEnd = performance.now();
  const writeFileTimeMs = writeEnd - writeStart;

  const totalEnd = performance.now();
  const totalPrepareTimeMs = totalEnd - totalStart;

  return {
    timestamp: new Date().toISOString(),
    voterFile,
    nVoters: voters.length,
    root: root.toString(),
    pathLength,
    buildTreeTimeMs,
    rootTimeMs,
    totalProofGenTimeMs,
    avgProofGenTimeMs,
    writeFileTimeMs,
    totalPrepareTimeMs,
  };
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const allMetrics = [];

  for (const nVoters of VOTER_SIZES) {
    const voterFile = getVoterFilePath(nVoters);

    console.log("\n========================================");
    console.log(`Processing ${nVoters} voters...`);
    console.log(`File: ${voterFile}`);

    const metrics = await prepareOneFile(voterFile);
    allMetrics.push(metrics);

    const latestJsonPath = getLatestJsonPath(nVoters);
    fs.writeFileSync(latestJsonPath, JSON.stringify(metrics, null, 2), "utf8");
    appendHistoryCSV(metrics);

    console.log(`Done ${nVoters} voters`);
    console.log(`buildTreeTimeMs: ${metrics.buildTreeTimeMs.toFixed(2)} ms`);
    console.log(`totalProofGenTimeMs: ${metrics.totalProofGenTimeMs.toFixed(2)} ms`);
    console.log(`writeFileTimeMs: ${metrics.writeFileTimeMs.toFixed(2)} ms`);
    console.log(`totalPrepareTimeMs: ${metrics.totalPrepareTimeMs.toFixed(2)} ms`);
  }

  fs.writeFileSync(SUMMARY_JSON_FILE, JSON.stringify(allMetrics, null, 2), "utf8");

  console.log("\nAll done.");
  console.log(`History CSV: ${HISTORY_CSV_FILE}`);
  console.log(`Summary JSON: ${SUMMARY_JSON_FILE}`);
}

main().catch((error) => {
  console.error("Prepare voters failed:", error);
  process.exit(1);
});