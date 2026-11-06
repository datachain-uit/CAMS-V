const fs = require("fs");
const path = require("path");
require("hardhat");

const { getContract } = require("../configs/blockchain");

const AGGREGATION_FILE = path.join(__dirname, "../data/aggregation.json");

const TOTAL_TRUSTEES = 7;

async function main() {
  const { votingContract } = await getContract(TOTAL_TRUSTEES + 1);

  if (!fs.existsSync(AGGREGATION_FILE)) {
    throw new Error("data/aggregation.json not found.");
  }

  const aggregation = JSON.parse(fs.readFileSync(AGGREGATION_FILE, "utf8"));

  if (
    !aggregation ||
    !Array.isArray(aggregation.C1_total_x) ||
    !Array.isArray(aggregation.C1_total_y) ||
    !Array.isArray(aggregation.C2_total_x) ||
    !Array.isArray(aggregation.C2_total_y)
  ) {
    throw new Error("aggregation.json is invalid.");
  }

  const C1List = aggregation.C1_total_x.map((x, i) => [
    x,
    aggregation.C1_total_y[i],
  ]);
  const C2List = aggregation.C2_total_x.map((x, i) => [
    x,
    aggregation.C2_total_y[i],
  ]);

  const tx = await votingContract.publishAllCipherTotals(C1List, C2List);
  console.log(`Aggregation published: ${tx.hash}`);
}

main().catch((error) => {
  console.error("Publish aggregation failed:", error);
  process.exit(1);
});
