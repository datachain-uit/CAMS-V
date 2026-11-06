const fs = require("fs");
const path = require("path");
const { buildPoseidon } = require("circomlibjs");

const merkleUtils = require("../utils/merkleUtils");

const VOTER_DB_FILE = path.join(__dirname, "../data/voter_data_for_db_1000.json");

async function prepareVoters() {
  const rawData = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));

  if (!Array.isArray(rawData) || rawData.length === 0) {
    throw new Error("No voters found.");
  }

  const voters = rawData.filter((item) => item && item.hashed_key !== undefined);

  if (voters.length === 0) {
    throw new Error("No valid voters with hashed_key found.");
  }

  const poseidon = await buildPoseidon();

  const leaves = voters.map((voter) => BigInt(voter.hashed_key));
  const tree = merkleUtils.buildMerkleTree(poseidon, leaves);
  const root = merkleUtils.getMerkleRoot(tree);

  voters.forEach((voter, index) => {
    const { pathElements, pathIndices } = merkleUtils.getMerkleProof(tree, index);
    voter.merkle_proof = {
      path_elements: pathElements.map(String),
      path_indices: pathIndices.map(String),
    };
  });

  const updatedVoters = [{ root: root.toString() }, ...voters];

  fs.writeFileSync(VOTER_DB_FILE, JSON.stringify(updatedVoters, null, 2));

  console.log("Build merkle tree completed");
}

prepareVoters().catch(console.error);