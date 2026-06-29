const fs = require("fs");
const path = require("path");
const { groth16 } = require("snarkjs");
const { buildBabyjub } = require("circomlibjs");
const { ethers } = require("hardhat");

const { getContract } = require("../configs/blockchain");

const USE_TALLY_CONTRACT = true;
const LOOKBACK_BLOCKS = 100;
const CHUNK_SIZE = 50;

const TALLY_INPUT_PATH = path.join(
  __dirname,
  "../circuits/inputs/tally_input.json",
);
const TALLY_WASM_PATH = path.join(
  __dirname,
  "../circuits/build/TallyValidity/TallyValidity_js/TallyValidity.wasm",
);
const TALLY_ZKEY_PATH = path.join(
  __dirname,
  "../circuits/build/TallyValidity/TallyValidity.zkey",
);

const FALLBACK_ID1 = 1n;
const FALLBACK_ID2 = 2n;

function modInverse(a, m) {
  a = ((a % m) + m) % m;

  let [r0, r1] = [a, m];
  let [s0, s1] = [1n, 0n];

  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }

  if (r0 !== 1n) {
    throw new Error("No modular inverse");
  }

  return ((s0 % m) + m) % m;
}

function findDiscreteLog(MPoint, G, F, babyjub, maxTries = 100000) {
  const identity = [F.e(0n), F.e(1n)];

  if (
    F.toObject(MPoint[0]) === F.toObject(identity[0]) &&
    F.toObject(MPoint[1]) === F.toObject(identity[1])
  ) {
    return 0;
  }

  let test = G;

  for (let m = 1; m <= maxTries; m++) {
    if (
      F.toObject(MPoint[0]) === F.toObject(test[0]) &&
      F.toObject(MPoint[1]) === F.toObject(test[1])
    ) {
      return m;
    }

    test = babyjub.addPoint(test, G);
  }

  return null;
}

function parseError(error) {
  return (
    error?.shortMessage ||
    error?.reason ||
    error?.error?.message ||
    error?.data?.message ||
    error?.message ||
    "Unknown error"
  );
}

async function getEventsChunked(contract, eventFilter, startBlock, endBlock) {
  const events = [];

  for (let from = startBlock; from <= endBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, endBlock);
    const chunk = await contract.queryFilter(eventFilter, from, to);
    events.push(...chunk);
  }

  return events;
}

async function main() {
  const startTime = performance.now();
  const babyjub = await buildBabyjub();
  const F = babyjub.F;
  const G = babyjub.Base8;
  const n = babyjub.subOrder;

  const { votingContract, tallyVerifierContract } = await getContract(0);

  const reader = votingContract;
  const submitter = USE_TALLY_CONTRACT ? tallyVerifierContract : votingContract;

  const latestBlock = await ethers.provider.getBlockNumber();
  const startBlock = Math.max(0, latestBlock - LOOKBACK_BLOCKS);

  const cipherEvents = await getEventsChunked(
    reader,
    reader.filters.CipherTotalPublished(),
    startBlock,
    latestBlock,
  );

  const partialEvents = await getEventsChunked(
    reader,
    reader.filters.PartialDecryptionSubmitted(),
    startBlock,
    latestBlock,
  );

  if (cipherEvents.length === 0) {
    throw new Error("No CipherTotalPublished event found.");
  }

  if (partialEvents.length < 2) {
    throw new Error("Need at least 2 PartialDecryptionSubmitted events.");
  }

  const sortedCipherEvents = [...cipherEvents].sort(
    (a, b) => Number(a.args.candidateId) - Number(b.args.candidateId),
  );

  const C2TotalX = [];
  const C2TotalY = [];

  for (const event of sortedCipherEvents) {
    C2TotalX.push(event.args.C2_total[0].toString());
    C2TotalY.push(event.args.C2_total[1].toString());
  }

  const trusteeDecryptions = {};

  for (const event of partialEvents) {
    const trustee = event.args.trustee.toLowerCase();
    const points = event.args.D_points.map((pair) => [
      pair[0].toString(),
      pair[1].toString(),
    ]);

    trusteeDecryptions[trustee] = points;
  }

  const trustees = Object.keys(trusteeDecryptions);
  if (trustees.length < 2) {
    throw new Error("Not enough trustee decryptions.");
  }

  const trustee1 = trustees[0];
  const trustee2 = trustees[1];

  let id1 = FALLBACK_ID1;
  let id2 = FALLBACK_ID2;

  try {
    const onChainId1 = await reader.trusteeID(trustee1);
    const onChainId2 = await reader.trusteeID(trustee2);

    if (
      BigInt(onChainId1.toString()) > 0n &&
      BigInt(onChainId2.toString()) > 0n
    ) {
      id1 = BigInt(onChainId1.toString());
      id2 = BigInt(onChainId2.toString());
    }
  } catch (_) {}

  const lambda1 = (((-id2 * modInverse(id1 - id2, n)) % n) + n) % n;
  const lambda2 = (((-id1 * modInverse(id2 - id1, n)) % n) + n) % n;

  const nCandidates = C2TotalX.length;

  if (
    trusteeDecryptions[trustee1].length < nCandidates ||
    trusteeDecryptions[trustee2].length < nCandidates
  ) {
    throw new Error("D_points length does not match candidate count.");
  }

  const finalResults = [];
  const inputObject = {
    C2_total_x: [],
    C2_total_y: [],
    D_x: [],
    D_y: [],
    lambda: [lambda1.toString(), lambda2.toString()],
    Mx: [],
    My: [],
  };

  for (let i = 0; i < nCandidates; i++) {
    const C2 = [F.e(BigInt(C2TotalX[i])), F.e(BigInt(C2TotalY[i]))];
    const D1 = trusteeDecryptions[trustee1][i].map((value) =>
      F.e(BigInt(value)),
    );
    const D2 = trusteeDecryptions[trustee2][i].map((value) =>
      F.e(BigInt(value)),
    );

    const D1Scaled = babyjub.mulPointEscalar(D1, lambda1);
    const D2Scaled = babyjub.mulPointEscalar(D2, lambda2);
    const sumD = babyjub.addPoint(D1Scaled, D2Scaled);

    const negSumD = [F.neg(sumD[0]), sumD[1]];
    const M = babyjub.addPoint(C2, negSumD);

    const votes = findDiscreteLog(M, G, F, babyjub, 10000);

    finalResults.push({
      candidateId: i + 1,
      votes: votes ?? "unknown",
    });

    inputObject.C2_total_x.push(C2TotalX[i]);
    inputObject.C2_total_y.push(C2TotalY[i]);
    inputObject.D_x.push([
      trusteeDecryptions[trustee1][i][0],
      trusteeDecryptions[trustee2][i][0],
    ]);
    inputObject.D_y.push([
      trusteeDecryptions[trustee1][i][1],
      trusteeDecryptions[trustee2][i][1],
    ]);
    inputObject.Mx.push(F.toObject(M[0]).toString());
    inputObject.My.push(F.toObject(M[1]).toString());
  }

  fs.mkdirSync(path.dirname(TALLY_INPUT_PATH), { recursive: true });
  fs.writeFileSync(TALLY_INPUT_PATH, JSON.stringify(inputObject, null, 2));

  const input = JSON.parse(fs.readFileSync(TALLY_INPUT_PATH, "utf8"));
  const { proof, publicSignals } = await groth16.fullProve(
    input,
    TALLY_WASM_PATH,
    TALLY_ZKEY_PATH,
  );

  const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
  const argv = calldata
    .replace(/["[\]\s]/g, "")
    .split(",")
    .map((x) => BigInt(x).toString());

  const a = [argv[0], argv[1]];
  const b = [
    [argv[2], argv[3]],
    [argv[4], argv[5]],
  ];
  const c = [argv[6], argv[7]];
  const inputSignals = argv.slice(8);

  await submitter.submitTallyProof(a, b, c, inputSignals);

  const endTime = performance.now();

  // Calculate the time difference in milliseconds
  const tallyTime = (endTime - startTime).toFixed(2);
  console.log(`Tally time: ${tallyTime} ms`);
  console.log("Final results:", finalResults);

  const counts = finalResults.map((x) => Number(x.votes));
  await votingContract.revealResults(counts);
  console.log("Results revealed on-chain.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Tally failed:", parseError(error));
  process.exit(1);
});
