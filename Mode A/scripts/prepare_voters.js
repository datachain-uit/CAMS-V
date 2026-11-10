// const fs = require("fs");
// const path = require("path");
// const { buildPoseidon } = require("circomlibjs");

// const merkleUtils = require("../utils/merkleUtils");

// const VOTER_DB_FILE = path.join(__dirname, "../data/voter_data_for_db_1000.json");

// async function prepareVoters() {
//   const rawData = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));

//   if (!Array.isArray(rawData) || rawData.length === 0) {
//     throw new Error("No voters found.");
//   }

//   const voters = rawData.filter((item) => item && item.hashed_key !== undefined);

//   if (voters.length === 0) {
//     throw new Error("No valid voters with hashed_key found.");
//   }

//   const poseidon = await buildPoseidon();

//   const leaves = voters.map((voter) => BigInt(voter.hashed_key));
//   const tree = merkleUtils.buildMerkleTree(poseidon, leaves);
//   const root = merkleUtils.getMerkleRoot(tree);

//   voters.forEach((voter, index) => {
//     const { pathElements, pathIndices } = merkleUtils.getMerkleProof(tree, index);
//     voter.merkle_proof = {
//       path_elements: pathElements.map(String),
//       path_indices: pathIndices.map(String),
//     };
//   });

//   const updatedVoters = [{ root: root.toString() }, ...voters];

//   fs.writeFileSync(VOTER_DB_FILE, JSON.stringify(updatedVoters, null, 2));

//   console.log("Build merkle tree completed");
// }

// prepareVoters().catch(console.error);


const fs = require("fs");
const path = require("path");
const { buildPoseidon } = require("circomlibjs");

const merkleUtils = require("../utils/merkleUtils");

const VOTER_DB_FILE = path.join(
  __dirname,
  "../data/voter_data_for_db_1000.json"
);

const TMP_FILE = VOTER_DB_FILE + ".tmp";

const BATCH_SIZE = 10000;

function writeAsync(stream, data) {
  return new Promise((resolve, reject) => {
    const ok = stream.write(data);

    if (ok) {
      resolve();
    } else {
      stream.once("drain", resolve);
      stream.once("error", reject);
    }
  });
}

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

  const stream = fs.createWriteStream(TMP_FILE, {
    flags: "w",
    encoding: "utf8",
    highWaterMark: 1024 * 1024,
  });

  await writeAsync(stream, "[\n");

  await writeAsync(
    stream,
    JSON.stringify(
      {
        root: root.toString(),
      },
      null,
      2
    )
  );

  let batch = [];

  for (let index = 0; index < voters.length; index++) {
    const voter = voters[index];

    const { pathElements, pathIndices } = merkleUtils.getMerkleProof(
      tree,
      index
    );

    const { merkle_proof, ...voterWithoutOldProof } = voter;

    const voterWithProof = {
      ...voterWithoutOldProof,
      merkle_proof: {
        path_elements: pathElements.map(String),
        path_indices: pathIndices.map(String),
      },
    };

    batch.push(JSON.stringify(voterWithProof, null, 2));

    if (batch.length >= BATCH_SIZE) {
      await writeAsync(stream, ",\n" + batch.join(",\n"));
      batch = [];

      console.log(`Generated proofs: ${index + 1}/${voters.length}`);
    }
  }

  if (batch.length > 0) {
    await writeAsync(stream, ",\n" + batch.join(",\n"));
    batch = [];
  }

  await writeAsync(stream, "\n]\n");

  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.once("error", reject);
  });

  fs.renameSync(TMP_FILE, VOTER_DB_FILE);
}

prepareVoters().catch((err) => {
  console.error(err);

  if (fs.existsSync(TMP_FILE)) {
    console.error("Temp file kept at:", TMP_FILE);
  }

  process.exit(1);
});