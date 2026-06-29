const fs = require("fs");
const path = require("path");
const { groth16 } = require("snarkjs");
const { buildBabyjub } = require("circomlibjs");
const { ethers } = require("hardhat");

const { getContract } = require("../configs/blockchain");

const DKG_PATH = path.join(__dirname, "../data/dkgKeys");
const WASM_PATH = path.join(
  __dirname,
  "../circuits/build/PartialDecryption/PartialDecryption_js/PartialDecryption.wasm",
);
const ZKEY_PATH = path.join(
  __dirname,
  "../circuits/build/PartialDecryption/PartialDecryption.zkey",
);

const RUN_CONFIG = [
  { index: 0, keyFile: "Admin_Trustee.json", name: "Admin (Trustee 3)" },
  { index: 2, keyFile: "Trustee_1.json", name: "Trustee 1" },
];

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

async function main() {
  const startTime = performance.now();
  const babyjub = await buildBabyjub();
  const { F } = babyjub;

  const { votingContract: contractReader } = await getContract(0);

  const latestBlock = await ethers.provider.getBlockNumber();
  const startBlock = Math.max(0, latestBlock - 1000);

  const filter = contractReader.filters.CipherTotalPublished();
  const events = await contractReader.queryFilter(
    filter,
    startBlock,
    latestBlock,
  );

  if (events.length === 0) {
    throw new Error("No CipherTotalPublished event found.");
  }

  const sortedEvents = [...events].sort(
    (a, b) => Number(a.args.candidateId) - Number(b.args.candidateId),
  );

  let C1Sum = [
    F.e(BigInt(sortedEvents[0].args.C1_total[0])),
    F.e(BigInt(sortedEvents[0].args.C1_total[1])),
  ];

  for (let i = 1; i < sortedEvents.length; i++) {
    const nextC1 = [
      F.e(BigInt(sortedEvents[i].args.C1_total[0])),
      F.e(BigInt(sortedEvents[i].args.C1_total[1])),
    ];
    C1Sum = babyjub.addPoint(C1Sum, nextC1);
  }

  const C1SumX = F.toObject(C1Sum[0]).toString();
  const C1SumY = F.toObject(C1Sum[1]).toString();

  for (const trustee of RUN_CONFIG) {
    const { votingContract } = await getContract(trustee.index);

    const keyData = JSON.parse(
      fs.readFileSync(path.join(DKG_PATH, trustee.keyFile), "utf8"),
    );

    const share = BigInt(keyData.share);
    const pkShare = keyData.pk_share;

    const DPoints = sortedEvents.map((event) => {
      const C1 = [
        F.e(BigInt(event.args.C1_total[0])),
        F.e(BigInt(event.args.C1_total[1])),
      ];
      const Di = babyjub.mulPointEscalar(C1, share);

      return [F.toObject(Di[0]).toString(), F.toObject(Di[1]).toString()];
    });

    const DTotal = babyjub.mulPointEscalar(C1Sum, share);

    const witnessInput = {
      s_i: share.toString(),
      C1x: C1SumX,
      C1y: C1SumY,
      D_ix: F.toObject(DTotal[0]).toString(),
      D_iy: F.toObject(DTotal[1]).toString(),
      PKx: pkShare.x.toString(),
      PKy: pkShare.y.toString(),
    };

    console.log(`Generating proof for ${trustee.name}`);

    const { proof, publicSignals } = await groth16.fullProve(
      witnessInput,
      WASM_PATH,
      ZKEY_PATH,
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

    if (inputSignals.length !== 1) {
      throw new Error(
        `inputSignals.length=${inputSignals.length} but contract expects uint[1].`,
      );
    }

    await votingContract.verifyPartialProof.staticCall(a, b, c, inputSignals);

    const verifyTx = await votingContract.verifyPartialProof(
      a,
      b,
      c,
      inputSignals,
    );
    await verifyTx.wait();

    const publishTx = await votingContract.publishPartialDecryption(DPoints);
    await publishTx.wait();
    const endTime = performance.now();

    // Calculate the time difference in milliseconds
    const partialDecryptionTime = (endTime - startTime).toFixed(2);
    console.log(
      `Partial decryption time for ${trustee.name}: ${partialDecryptionTime} ms`,
    );
  }

  const thresholdCount = await contractReader.thresholdCount();
  console.log(`Threshold count: ${thresholdCount.toString()}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Partial decryption failed:", parseError(error));
  process.exit(1);
});
