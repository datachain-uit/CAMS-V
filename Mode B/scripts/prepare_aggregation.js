const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { performance } = require("perf_hooks");
const { buildBabyjub, buildPoseidon } = require("circomlibjs");

const { getContract } = require("../configs/blockchain");

const { ethers } = hre;

const VOTE_FILE = path.join(__dirname, "../data/vote.json");
const AGGREGATION_FILE = path.join(__dirname, "../data/aggregation.json");

const START_BLOCK = 1;
const STEP = 50;

async function getAllHashOnChain(votingContract) {
  const latestBlock = await ethers.provider.getBlockNumber();
  const hashSet = new Set();

  for (let from = START_BLOCK; from <= latestBlock; from += STEP) {
    const to = Math.min(from + STEP - 1, latestBlock);
    const events = await votingContract.queryFilter("VotePublished", from, to);

    for (const event of events) {
      if (event.args?.hashCipher) {
        hashSet.add(event.args.hashCipher.toString());
      }
    }
  }

  return hashSet;
}

async function main() {
  const startTime = performance.now();

  const { votingContract } = await getContract(1);

  const hashOnChain = await getAllHashOnChain(votingContract);
  if (hashOnChain.size === 0) {
    console.log("No on-chain votes found.");
    return;
  }

  if (!fs.existsSync(VOTE_FILE)) {
    throw new Error("data/vote.json not found.");
  }

  const votes = JSON.parse(fs.readFileSync(VOTE_FILE, "utf8"));
  if (!Array.isArray(votes) || votes.length === 0) {
    console.log("vote.json is empty.");
    return;
  }

  const babyjub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = babyjub.F;

  const nCandidates = votes[0].C1x.length;

  let C1TotalX = Array(nCandidates).fill(F.e(0n));
  let C1TotalY = Array(nCandidates).fill(F.e(1n));
  let C2TotalX = Array(nCandidates).fill(F.e(0n));
  let C2TotalY = Array(nCandidates).fill(F.e(1n));

  let validVotes = 0;

  for (const vote of votes) {
    let acc = F.e(0n);

    for (let i = 0; i < nCandidates; i++) {
      const hash = poseidon([
        BigInt(vote.C1x[i]),
        BigInt(vote.C1y[i]),
        BigInt(vote.C2x[i]),
        BigInt(vote.C2y[i]),
      ]);
      acc = poseidon([acc, hash]);
    }

    const hashCipherBytes32 = ethers.zeroPadValue(
      ethers.toBeHex(BigInt(F.toObject(acc))),
      32,
    );

    if (!hashOnChain.has(hashCipherBytes32)) {
      continue;
    }

    validVotes++;

    for (let i = 0; i < nCandidates; i++) {
      const C1 = [F.e(BigInt(vote.C1x[i])), F.e(BigInt(vote.C1y[i]))];
      const C2 = [F.e(BigInt(vote.C2x[i])), F.e(BigInt(vote.C2y[i]))];

      const nextC1 = babyjub.addPoint([C1TotalX[i], C1TotalY[i]], C1);
      const nextC2 = babyjub.addPoint([C2TotalX[i], C2TotalY[i]], C2);

      C1TotalX[i] = nextC1[0];
      C1TotalY[i] = nextC1[1];
      C2TotalX[i] = nextC2[0];
      C2TotalY[i] = nextC2[1];
    }
  }

  const endTime = performance.now();
  const aggregationTimeMs = endTime - startTime;
  
  const aggregation = {
    nCandidates,
    validVotes,
    totalVotesInFile: votes.length,
    C1_total_x: C1TotalX.map((x) => F.toObject(x).toString()),
    C1_total_y: C1TotalY.map((y) => F.toObject(y).toString()),
    C2_total_x: C2TotalX.map((x) => F.toObject(x).toString()),
    C2_total_y: C2TotalY.map((y) => F.toObject(y).toString()),
  };

  fs.writeFileSync(AGGREGATION_FILE, JSON.stringify(aggregation, null, 2));


  console.log(`Valid votes: ${validVotes}/${votes.length}`);
  console.log(`Total aggregation time: ${aggregationTimeMs.toFixed(2)} ms`);
}

main().catch((error) => {
  console.error("Prepare aggregation failed:", error);
  process.exit(1);
});