const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const hre = require("hardhat");
const { buildBabyjub } = require("circomlibjs");

const { getContract } = require("../configs/blockchain");

const { ethers } = hre;

const VOTER_DB_FILE = path.join(
  __dirname,
  "../data/voter_data_for_db_1000.json",
);
const DKG_FOLDER = path.join(__dirname, "../data/dkgKeys");

const ELECTION_ID = "ELC2026";
const ELECTION_NAME = "Demo Election";
const ELECTION_DURATION = 7 * 24 * 3600;
const NUM_CANDIDATES = 2;

const TOTAL_TRUSTEES = 7;
const THRESHOLD = 4;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function evalPolynomial(coeffs, x, n) {
  let result = 0n;
  const X = BigInt(x);

  for (let i = 0; i < coeffs.length; i++) {
    result = (result + coeffs[i] * X ** BigInt(i)) % n;
  }

  return result;
}

async function main() {
  if (THRESHOLD <= 0 || THRESHOLD > TOTAL_TRUSTEES) {
    throw new Error("Invalid THRESHOLD/TOTAL_TRUSTEES config");
  }

  const { votingContract } = await getContract();
  const signers = await hre.ethers.getSigners();

  const voterData = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
  if (!Array.isArray(voterData) || voterData.length < 2) {
    throw new Error("Invalid voter data.");
  }

  const rootEntry = voterData[0];
  if (!rootEntry || !rootEntry.root) {
    throw new Error("Merkle root not found. Please run prepare file first.");
  }

  const voters = voterData.slice(1);
  if (voters.length === 0) {
    throw new Error("No voters found.");
  }

  const root = BigInt(rootEntry.root);

  const startDate = Math.floor(Date.now() / 1000);
  const endDate = startDate + ELECTION_DURATION;
  const rootHex = ethers.zeroPadValue(ethers.toBeHex(root), 32);

  await (
    await votingContract.setElectionInfo(
      ELECTION_ID,
      ELECTION_NAME,
      startDate,
      endDate,
    )
  ).wait();

  for (let i = 1; i <= NUM_CANDIDATES; i++) {
    await (await votingContract.addCandidate(`Candidate ${i}`)).wait();
  }

  await (await votingContract.setMerkleRoot(rootHex)).wait();

  const aggregatorSigner = signers[TOTAL_TRUSTEES + 1];
  await (await votingContract.setAggregator(aggregatorSigner.address)).wait();

  const babyjub = await buildBabyjub();
  const { F, Base8: G, subOrder: n } = babyjub;

  ensureDir(DKG_FOLDER);

  const trusteeConfigs = Array.from({ length: TOTAL_TRUSTEES }, (_, i) => ({
    name: `Trustee_${i + 1}`,
    address: signers[i + 1].address,
    signerIndex: i + 1,
  }));

  const polynomials = trusteeConfigs.map((trustee) => ({
    ...trustee,
    coeffs: Array.from(
      { length: THRESHOLD },
      () => BigInt(`0x${crypto.randomBytes(32).toString("hex")}`) % n,
    ),
  }));

  const publicKeyPoint = polynomials.reduce(
    (acc, polynomial) =>
      babyjub.addPoint(acc, babyjub.mulPointEscalar(G, polynomial.coeffs[0])),
    [F.e(0n), F.e(1n)],
  );

  const publicKey = {
    x: F.toObject(publicKeyPoint[0]).toString(),
    y: F.toObject(publicKeyPoint[1]).toString(),
  };

  fs.writeFileSync(
    path.join(DKG_FOLDER, "public_key.json"),
    JSON.stringify(publicKey, null, 2),
  );

  const trusteeAddresses = [];

  for (let i = 0; i < trusteeConfigs.length; i++) {
    const id = BigInt(i + 1);

    const share = polynomials.reduce(
      (acc, polynomial) => (acc + evalPolynomial(polynomial.coeffs, id, n)) % n,
      0n,
    );

    const pkSharePoint = babyjub.mulPointEscalar(G, share);

    const keyData = {
      trustee: trusteeConfigs[i].name,
      address: trusteeConfigs[i].address,
      id: i + 1,
      signerIndex: trusteeConfigs[i].signerIndex,
      share: share.toString(),
      pk_share: {
        x: F.toObject(pkSharePoint[0]).toString(),
        y: F.toObject(pkSharePoint[1]).toString(),
      },
    };

    fs.writeFileSync(
      path.join(DKG_FOLDER, `${trusteeConfigs[i].name}.json`),
      JSON.stringify(keyData, null, 2),
    );

    trusteeAddresses.push(trusteeConfigs[i].address);
  }

  await (
    await votingContract.registerTrustees(trusteeAddresses, THRESHOLD)
  ).wait();

  console.log("Setup completed.");
  console.log(`Merkle root published for ${voters.length} voters.`);
  console.log(`Aggregator: ${aggregatorSigner.address}`);
  console.log(`Trustees registered: ${trusteeAddresses.length}`);
  console.log(`Threshold: ${THRESHOLD}/${TOTAL_TRUSTEES}`);
}

main().catch((error) => {
  console.error("Register failed:", error);
  process.exit(1);
});

// const fs = require("fs");
// const path = require("path");
// const crypto = require("crypto");
// const hre = require("hardhat");
// const { buildBabyjub } = require("circomlibjs");

// const { getContract } = require("../configs/blockchain");

// const { ethers } = hre;

// const VOTER_DB_FILE = path.join(
//   __dirname,
//   "../data/voter_data_for_db_1000.json",
// );
// const DKG_FOLDER = path.join(__dirname, "../data/dkgKeys");

// const ELECTION_ID = "ELC2026";
// const ELECTION_NAME = "Demo Election";
// const ELECTION_DURATION = 7 * 24 * 3600;
// const THRESHOLD = 2;

// function ensureDir(dirPath) {
//   fs.mkdirSync(dirPath, { recursive: true });
// }

// function evalPolynomial(coeffs, x, n) {
//   let result = 0n;
//   const X = BigInt(x);

//   for (let i = 0; i < coeffs.length; i++) {
//     result = (result + coeffs[i] * X ** BigInt(i)) % n;
//   }

//   return result;
// }

// async function main() {
//   const { votingContract } = await getContract();
//   const signers = await hre.ethers.getSigners();

//   const voterData = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
//   if (!Array.isArray(voterData) || voterData.length < 2) {
//     throw new Error("Invalid voter data.");
//   }

//   const rootEntry = voterData[0];
//   if (!rootEntry || !rootEntry.root) {
//     throw new Error("Merkle root not found. Please run prepare file first.");
//   }

//   const voters = voterData.slice(1);
//   if (voters.length === 0) {
//     throw new Error("No voters found.");
//   }

//   const root = BigInt(rootEntry.root);

//   const startDate = Math.floor(Date.now() / 1000);
//   const endDate = startDate + ELECTION_DURATION;
//   const rootHex = ethers.zeroPadValue(ethers.toBeHex(root), 32);

//   await (
//     await votingContract.setElectionInfo(
//       ELECTION_ID,
//       ELECTION_NAME,
//       startDate,
//       endDate,
//     )
//   ).wait();

//   await (await votingContract.setMerkleRoot(rootHex)).wait();

//   const aggregatorSigner = signers[3];
//   await (await votingContract.setAggregator(aggregatorSigner.address)).wait();

//   const babyjub = await buildBabyjub();
//   const { F, Base8: G, subOrder: n } = babyjub;

//   ensureDir(DKG_FOLDER);

//   const trusteeConfigs = [
//     { name: "Trustee_1", address: signers[1].address },
//     { name: "Trustee_2", address: signers[2].address },
//     { name: "Admin_Trustee", address: signers[0].address },
//   ];

//   const polynomials = trusteeConfigs.map((trustee) => ({
//     ...trustee,
//     coeffs: Array.from(
//       { length: THRESHOLD },
//       () => BigInt(`0x${crypto.randomBytes(32).toString("hex")}`) % n,
//     ),
//   }));

//   const publicKeyPoint = polynomials.reduce(
//     (acc, polynomial) =>
//       babyjub.addPoint(acc, babyjub.mulPointEscalar(G, polynomial.coeffs[0])),
//     [F.e(0n), F.e(1n)],
//   );

//   const publicKey = {
//     x: F.toObject(publicKeyPoint[0]).toString(),
//     y: F.toObject(publicKeyPoint[1]).toString(),
//   };

//   fs.writeFileSync(
//     path.join(DKG_FOLDER, "public_key.json"),
//     JSON.stringify(publicKey, null, 2),
//   );

//   const trusteeAddresses = [];

//   for (let i = 0; i < trusteeConfigs.length; i++) {
//     const id = BigInt(i + 1);

//     const share = polynomials.reduce(
//       (acc, polynomial) => (acc + evalPolynomial(polynomial.coeffs, id, n)) % n,
//       0n,
//     );

//     const pkSharePoint = babyjub.mulPointEscalar(G, share);

//     const keyData = {
//       trustee: trusteeConfigs[i].name,
//       address: trusteeConfigs[i].address,
//       id: i + 1,
//       share: share.toString(),
//       pk_share: {
//         x: F.toObject(pkSharePoint[0]).toString(),
//         y: F.toObject(pkSharePoint[1]).toString(),
//       },
//     };

//     fs.writeFileSync(
//       path.join(DKG_FOLDER, `${trusteeConfigs[i].name}.json`),
//       JSON.stringify(keyData, null, 2),
//     );

//     trusteeAddresses.push(trusteeConfigs[i].address);
//   }

//   await (await votingContract.registerTrustees(trusteeAddresses)).wait();

//   console.log("Setup completed.");
//   console.log(`Merkle root published for ${voters.length} voters.`);
//   console.log(`Aggregator: ${aggregatorSigner.address}`);
//   console.log(`Trustees registered: ${trusteeAddresses.length}`);
// }

// main().catch((error) => {
//   console.error("Register failed:", error);
//   process.exit(1);
// });
