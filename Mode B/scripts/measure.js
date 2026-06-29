const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const PREPARE_B = path.join(ROOT, "scripts", "prepare.js");
const MEASURE = path.join(ROOT, "scripts", "prepare_measure.js");

const VARIABLE_CIRCUITS = [
  "VoteProofCombined",
  "TallyValidity",
];

const FIXED_CIRCUIT = "PartialDecryption";

const SCENARIOS = [
  { id: "S2", n: 256, q: 2, s: 1 },
  { id: "S3", n: 5000, q: 2, s: 1 },
  { id: "S4", n: 10000, q: 2, s: 1 },
  { id: "S5", n: 1000, q: 4, s: 1 },
  { id: "S6", n: 1000, q: 8, s: 1 },
  { id: "S7", n: 1000, q: 10, s: 2 },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });

  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function fileExists(p) {
  return fs.existsSync(p);
}

function readCsvRows(csvPath) {
  if (!fileExists(csvPath)) return [];
  const text = fs.readFileSync(csvPath, "utf8").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length <= 1) return [];
  return lines.slice(1);
}

function appendSummary(summaryCsv, scenario, rows) {
  const header =
    "scenario,n,q,s,circuit,compile_time_s,compile_size_mb,zkey_time_s,zkey_size_mb,export_time_s,export_size_mb,total_time_s,total_size_mb,constraints\n";

  if (!fileExists(summaryCsv)) {
    fs.writeFileSync(summaryCsv, header, "utf8");
  }

  for (const row of rows) {
    fs.appendFileSync(
      summaryCsv,
      `${scenario.id},${scenario.n},${scenario.q},${scenario.s},${row}\n`,
      "utf8",
    );
  }
}

function main() {
  if (!fileExists(PREPARE_B)) {
    throw new Error(`Missing prepare script: ${PREPARE_B}`);
  }

  if (!fileExists(MEASURE)) {
    throw new Error(`Missing measure script: ${MEASURE}`);
  }

  const metricsRoot = path.join(
    ROOT,
    "data",
    "metrics",
    "mode_b_setup_scenarios",
  );
  ensureDir(metricsRoot);

  const summaryCsv = path.join(metricsRoot, "mode_b_setup_summary.csv");

  // đo PartialDecryption 1 lần
  const fixedDir = path.join(metricsRoot, "fixed_partial");
  ensureDir(fixedDir);

  run("node", [MEASURE, FIXED_CIRCUIT], {
    env: {
      ...process.env,
      METRICS_DIR: fixedDir,
    },
  });

  for (const sc of SCENARIOS) {
    console.log("\n====================================");
    console.log(`Running ${sc.id} | n=${sc.n}, q=${sc.q}, s=${sc.s}`);
    console.log("====================================");

    run("node", [PREPARE_B, String(sc.n), String(sc.q), String(sc.s)]);

    const scenarioMetricsDir = path.join(metricsRoot, sc.id);
    ensureDir(scenarioMetricsDir);

    run("node", [MEASURE, ...VARIABLE_CIRCUITS], {
      env: {
        ...process.env,
        METRICS_DIR: scenarioMetricsDir,
      },
    });

    const scenarioCsv = path.join(
      scenarioMetricsDir,
      "circuit_setup_metrics.csv",
    );
    const rows = readCsvRows(scenarioCsv);
    appendSummary(summaryCsv, sc, rows);
  }

  console.log("\nDone.");
  console.log(`Summary CSV: ${summaryCsv}`);
}

try {
  main();
} catch (error) {
  console.error("\nERROR:", error.message || error);
  process.exit(1);
}