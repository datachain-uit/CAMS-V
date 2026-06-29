const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildBabyjub } = require("circomlibjs");
const { performance } = require("perf_hooks");

const DKG_PUBLIC_KEY_PATH = path.join(
  __dirname,
  "../data/dkgKeys/public_key.json",
);

const OUTPUT_DIR = path.join(__dirname, "../data/ciphertext_storage_results");

const NUM_CANDIDATES = 10;
const NUM_SELECTIONS = 1;

const SUMMARY_NAME = `summary${NUM_CANDIDATES}${NUM_SELECTIONS}`;
const SUMMARY_CSV = path.join(OUTPUT_DIR, `${SUMMARY_NAME}.csv`);
const SUMMARY_JSON = path.join(OUTPUT_DIR, `${SUMMARY_NAME}.json`);

const SCALE_POINTS = [1000, 10000, 20000, 40000, 60000, 80000, 100000];
// const SCALE_POINTS = [10, 20];

const PROGRESS_EVERY = 5000;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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

function createMessages(numCandidates, selectedChoices) {
  const messages = Array(numCandidates).fill(0n);

  for (const idx of selectedChoices) {
    if (idx < 0 || idx >= numCandidates) {
      throw new Error(`Invalid selected choice index: ${idx}`);
    }
    messages[idx] = 1n;
  }

  return messages;
}

async function encryptVote(babyjub, publicKey, numCandidates, selectedChoices) {
  const F = babyjub.F;
  const G = babyjub.Base8;
  const n = babyjub.subOrder;

  const messages = createMessages(numCandidates, selectedChoices);

  const C1x = [];
  const C1y = [];
  const C2x = [];
  const C2y = [];

  for (let i = 0; i < numCandidates; i++) {
    const randomBytes = crypto.randomBytes(32);
    const randomness = BigInt(`0x${randomBytes.toString("hex")}`) % n;

    const C1 = babyjub.mulPointEscalar(G, randomness);
    const rPK = babyjub.mulPointEscalar(publicKey, randomness);
    const mG = babyjub.mulPointEscalar(G, messages[i]);
    const C2 = babyjub.addPoint(mG, rPK);

    C1x.push(F.toObject(C1[0]).toString());
    C1y.push(F.toObject(C1[1]).toString());
    C2x.push(F.toObject(C2[0]).toString());
    C2y.push(F.toObject(C2[1]).toString());
  }

  return { C1x, C1y, C2x, C2y };
}

function serializeCiphertext(ciphertext) {
  return JSON.stringify(ciphertext);
}

function formatMB(bytes) {
  return bytes / (1024 * 1024);
}

function formatKB(bytes) {
  return bytes / 1024;
}

function writeSummaryCSV(rows) {
  const header = [
    "nBallots",
    "qCandidates",
    "sSelections",
    "totalCipherBytes",
    "totalCipherKB",
    "totalCipherMB",
    "avgCipherBytes",
    "avgCipherKB",
    "minCipherBytes",
    "maxCipherBytes",
    "totalEncryptTimeMs",
    "avgEncryptTimeMs",
  ].join(",");

  const lines = rows.map((row) =>
    [
      row.nBallots,
      row.qCandidates,
      row.sSelections,
      row.totalCipherBytes,
      row.totalCipherKB.toFixed(4),
      row.totalCipherMB.toFixed(4),
      row.avgCipherBytes.toFixed(2),
      row.avgCipherKB.toFixed(4),
      row.minCipherBytes,
      row.maxCipherBytes,
      row.totalEncryptTimeMs.toFixed(2),
      row.avgEncryptTimeMs.toFixed(4),
    ].join(","),
  );

  fs.writeFileSync(SUMMARY_CSV, `${header}\n${lines.join("\n")}\n`, "utf8");
}

async function runScenario(
  babyjub,
  publicKey,
  nBallots,
  numCandidates,
  numSelections,
) {
  let totalCipherBytes = 0;
  let minCipherBytes = Number.POSITIVE_INFINITY;
  let maxCipherBytes = 0;
  let totalEncryptTimeMs = 0;

  for (let i = 0; i < nBallots; i++) {
    const selectedChoices = pickRandomChoices(numCandidates, numSelections);

    const startTime = performance.now();
    const ciphertext = await encryptVote(
      babyjub,
      publicKey,
      numCandidates,
      selectedChoices,
    );
    const endTime = performance.now();

    const encryptTimeMs = endTime - startTime;
    totalEncryptTimeMs += encryptTimeMs;

    const cipherPayload = serializeCiphertext(ciphertext);
    const cipherBytes = Buffer.byteLength(cipherPayload, "utf8");

    totalCipherBytes += cipherBytes;
    if (cipherBytes < minCipherBytes) minCipherBytes = cipherBytes;
    if (cipherBytes > maxCipherBytes) maxCipherBytes = cipherBytes;

    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === nBallots) {
      console.log(
        `[${nBallots}] processed ${
          i + 1
        }/${nBallots} ballots | current avg = ${(
          totalCipherBytes /
          (i + 1)
        ).toFixed(2)} bytes`,
      );
    }
  }

  return {
    nBallots,
    qCandidates: numCandidates,
    sSelections: numSelections,
    totalCipherBytes,
    totalCipherKB: formatKB(totalCipherBytes),
    totalCipherMB: formatMB(totalCipherBytes),
    avgCipherBytes: totalCipherBytes / nBallots,
    avgCipherKB: formatKB(totalCipherBytes / nBallots),
    minCipherBytes,
    maxCipherBytes,
    totalEncryptTimeMs,
    avgEncryptTimeMs: totalEncryptTimeMs / nBallots,
  };
}

async function main() {
  ensureDir(OUTPUT_DIR);

  if (!fs.existsSync(DKG_PUBLIC_KEY_PATH)) {
    throw new Error(
      `public_key.json not found at ${DKG_PUBLIC_KEY_PATH}. Run register.js first.`,
    );
  }

  const publicKeyData = JSON.parse(
    fs.readFileSync(DKG_PUBLIC_KEY_PATH, "utf8"),
  );

  const babyjub = await buildBabyjub();
  const F = babyjub.F;
  const publicKey = [
    F.e(BigInt(publicKeyData.x)),
    F.e(BigInt(publicKeyData.y)),
  ];

  const summaryRows = [];

  console.log("Starting ciphertext storage measurement...");
  console.log(`Candidates: ${NUM_CANDIDATES}`);
  console.log(`Selections: ${NUM_SELECTIONS}`);
  console.log(`Scale points: ${SCALE_POINTS.join(", ")}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  for (const nBallots of SCALE_POINTS) {
    console.log("\n==================================================");
    console.log(`Running scenario for n = ${nBallots} ballots`);

    const row = await runScenario(
      babyjub,
      publicKey,
      nBallots,
      NUM_CANDIDATES,
      NUM_SELECTIONS,
    );

    summaryRows.push(row);

    console.log(`Finished n = ${nBallots}`);
    console.log(`  totalCipherBytes = ${row.totalCipherBytes}`);
    console.log(`  totalCipherMB    = ${row.totalCipherMB.toFixed(4)} MB`);
    console.log(
      `  avgCipherBytes   = ${row.avgCipherBytes.toFixed(2)} bytes/vote`,
    );
    console.log(
      `  avgEncryptTimeMs = ${row.avgEncryptTimeMs.toFixed(4)} ms/vote`,
    );
  }

  writeSummaryCSV(summaryRows);
  fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summaryRows, null, 2), "utf8");

  console.log("\nDone.");
  console.log(`Summary CSV: ${SUMMARY_CSV}`);
  console.log(`Summary JSON: ${SUMMARY_JSON}`);
}

main().catch((error) => {
  console.error("Ciphertext storage measurement failed:", error);
  process.exit(1);
});
