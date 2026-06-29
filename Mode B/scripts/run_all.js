const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const NETWORK = process.argv[2] || "localhost";

const ROOT_DIR = path.resolve(__dirname, "..");
const BLOCKCHAIN_CONFIG_PATH = path.join(ROOT_DIR, "configs", "blockchain.js");
const DEPLOYMENT_FILE = path.join(ROOT_DIR, "data", "deployments.json");

const CIRCUITS = [
  "VoteProofCombined",
  "TallyValidity",
  // "PartialDecryption",
];

const SYSTEM_SCRIPTS = [
  "test/register.js",
  "test/vote.js",
  "scripts/prepare_aggregation.js",
  "test/aggregate.js",
  "test/partial.js",
  "test/tally.js",
];

function runCommand(cmd, args, options = {}) {
  const { cwd = ROOT_DIR } = options;

  console.log(`\n$ ${cmd} ${args.join(" ")}`);

  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
}

function readDeploymentFile() {
  ensureFileExists(DEPLOYMENT_FILE);

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));

  if (!deployment.votingAddress || !deployment.tallyAddress) {
    throw new Error(
      "deployments.json does not contain votingAddress or tallyAddress.",
    );
  }

  return deployment;
}

function updateBlockchainConfig(votingAddress, tallyAddress) {
  let content = fs.readFileSync(BLOCKCHAIN_CONFIG_PATH, "utf8");

  content = content.replace(
    /const VOTING_ADDRESS = "0x[a-fA-F0-9]{40}";/,
    `const VOTING_ADDRESS = "${votingAddress}";`,
  );

  content = content.replace(
    /const TALLY_VERIFIER_ADDRESS = "0x[a-fA-F0-9]{40}";/,
    `const TALLY_VERIFIER_ADDRESS = "${tallyAddress}";`,
  );

  fs.writeFileSync(BLOCKCHAIN_CONFIG_PATH, content, "utf8");
}

async function main() {
  ensureFileExists(BLOCKCHAIN_CONFIG_PATH);

  runCommand("node", ["scripts/circom.js", ...CIRCUITS]);

  console.log(`Network: ${NETWORK}`);

  runCommand("npx", [
    "hardhat",
    "run",
    "scripts/deploy.js",
    "--network",
    NETWORK,
  ]);

  const deployment = readDeploymentFile();
  updateBlockchainConfig(deployment.votingAddress, deployment.tallyAddress);

  console.log(`Updated blockchain config.`);
  console.log(`VOTING_ADDRESS = ${deployment.votingAddress}`);
  console.log(`TALLY_VERIFIER_ADDRESS = ${deployment.tallyAddress}`);

  // runCommand("node", ["scripts/gen_voter.js"]);
  runCommand("node", ["scripts/prepare_voters.js"]);

  for (const script of SYSTEM_SCRIPTS) {
    runCommand("npx", ["hardhat", "run", script, "--network", NETWORK]);
  }

  console.log("\nAll steps completed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nRun all failed:");
  console.error(error.message || error);
  process.exit(1);
});