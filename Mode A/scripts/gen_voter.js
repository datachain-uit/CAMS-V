// import fs from "fs";
// import path from "path";
// import { fileURLToPath } from "url";
// import { randomBytes } from "crypto";
// import * as secp from "@noble/secp256k1";
// import { buildEddsa, buildPoseidon } from "circomlibjs";

// const { bytesToHex } = secp.etc;

// function randomBigInt(modulus) {
//   let rand;
//   const nbytes = Math.ceil(modulus.toString(2).length / 8);
//   do {
//     rand = BigInt("0x" + randomBytes(nbytes).toString("hex"));
//   } while (rand >= modulus || rand === 0n);
//   return rand;
// }

// export const generateSecpKeys = () => {
//   const sk = secp.utils.randomSecretKey();
//   const pk = secp.getPublicKey(sk);
//   const skHex = bytesToHex(sk);
//   const pkHex = bytesToHex(pk);
//   return { skHex, pkHex };
// };

// export const generateBabyJubJubKeys = (eddsa) => {
//   const babyjub = eddsa.babyJub;
//   const F = babyjub.F;
//   const subOrder = BigInt(babyjub.subOrder.toString());

//   const sk = randomBigInt(subOrder);
//   const pkPoint = babyjub.mulPointEscalar(babyjub.Base8, sk);
//   const pk = [F.toObject(pkPoint[0]), F.toObject(pkPoint[1])];

//   return {
//     sk: sk.toString(),
//     pk: pk.map((v) => v.toString()),
//   };
// };

// async function main() {
//   const NUM_VOTERS_TO_GENERATE = 500000;
//   const ELECTION_ID = "ELC2026";

//   const __filename = fileURLToPath(import.meta.url);
//   const __dirname = path.dirname(__filename);

//   const outputDbJsonPath = path.join(
//     __dirname,
//     "..",
//     "data",
//     `voter_data_for_db_${NUM_VOTERS_TO_GENERATE}.json`,
//   );

//   const outputScriptJsonPath = path.join(
//     __dirname,
//     "..",
//     "data",
//     `voter_secrets_for_script_${NUM_VOTERS_TO_GENERATE}.json`,
//   );

//   console.log("⚙️  Initializing circomlibjs (eddsa + poseidon)...");
//   const eddsa = await buildEddsa();
//   const poseidon = await buildPoseidon();
//   const F = eddsa.babyJub.F;
//   console.log("Initialization complete.");

//   const elecBytes = Array.from(ELECTION_ID).map((c) => BigInt(c.charCodeAt(0)));
//   const electionHashFp = poseidon(elecBytes);
//   const election_hash = F.toObject(electionHashFp).toString();

//   const dbDataList = [];
//   const secretDataList = [];

//   console.log(`Generating data for ${NUM_VOTERS_TO_GENERATE} voters...`);

//   for (let i = 0; i < NUM_VOTERS_TO_GENERATE; i++) {
//     const { pkHex: pk_secp } = generateSecpKeys();

//     const { sk: sk_bjj, pk: pk_bjj } = generateBabyJubJubKeys(eddsa);

//     const pk_bjj_bigint = [BigInt(pk_bjj[0]), BigInt(pk_bjj[1])];
//     const hashedKeyFp = poseidon(pk_bjj_bigint);
//     const hashedKey = F.toObject(hashedKeyFp).toString();

//     const nullifierInputs = [BigInt(sk_bjj), BigInt(election_hash)];
//     const nullifierFp = poseidon(nullifierInputs);
//     const nullifier = F.toObject(nullifierFp).toString();

//     const voterEntry_DB = {
//       hashed_key: hashedKey,
//       election_id: ELECTION_ID,
//       is_valid: true,
//       pk_secp: pk_secp,
//     };
//     dbDataList.push(voterEntry_DB);

//     const voterEntry_Secret = {
//       hashed_key: hashedKey,
//       sk_bjj: sk_bjj,
//       pk_bjj: pk_bjj,
//       pk_secp: pk_secp,
//       nullifier: nullifier,
//       election_hash: election_hash,
//     };
//     secretDataList.push(voterEntry_Secret);

//     if ((i + 1) % 20 === 0) {
//       console.log(`Generated ${i + 1}/${NUM_VOTERS_TO_GENERATE}`);
//     }
//   }

//   fs.writeFileSync(
//     outputDbJsonPath,
//     JSON.stringify(dbDataList, null, 2),
//     "utf8",
//   );

//   fs.writeFileSync(
//     outputScriptJsonPath,
//     JSON.stringify(secretDataList, null, 2),
//     "utf8",
//   );
// }

// main().catch((err) => {
//   console.error("Fail:", err);
//   process.exit(1);
// });

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { once } from "events";
import * as secp from "@noble/secp256k1";
import { buildEddsa, buildPoseidon } from "circomlibjs";

const { bytesToHex } = secp.etc;

function randomBigInt(modulus) {
  let rand;
  const nbytes = Math.ceil(modulus.toString(2).length / 8);

  do {
    rand = BigInt("0x" + randomBytes(nbytes).toString("hex"));
  } while (rand >= modulus || rand === 0n);

  return rand;
}

export const generateSecpKeys = () => {
  const sk = secp.utils.randomSecretKey();
  const pk = secp.getPublicKey(sk);

  const skHex = bytesToHex(sk);
  const pkHex = bytesToHex(pk);

  return { skHex, pkHex };
};

export const generateBabyJubJubKeys = (eddsa) => {
  const babyjub = eddsa.babyJub;
  const F = babyjub.F;
  const subOrder = BigInt(babyjub.subOrder.toString());

  const sk = randomBigInt(subOrder);
  const pkPoint = babyjub.mulPointEscalar(babyjub.Base8, sk);

  const pk = [F.toObject(pkPoint[0]), F.toObject(pkPoint[1])];

  return {
    sk: sk.toString(),
    pk: pk.map((v) => v.toString()),
  };
};

async function writeWithBackpressure(stream, data) {
  if (!stream.write(data)) {
    await once(stream, "drain");
  }
}

class JsonArrayBatchWriter {
  constructor(filePath, batchSize = 10000) {
    this.filePath = filePath;
    this.batchSize = batchSize;
    this.stream = fs.createWriteStream(filePath, { encoding: "utf8" });
    this.buffer = [];
    this.isFirstItem = true;
  }

  async start() {
    await writeWithBackpressure(this.stream, "[\n");
  }

  async push(obj) {
    this.buffer.push(JSON.stringify(obj));

    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush() {
    if (this.buffer.length === 0) return;

    let text = this.buffer.join(",\n");

    if (!this.isFirstItem) {
      text = ",\n" + text;
    }

    await writeWithBackpressure(this.stream, text);

    this.isFirstItem = false;
    this.buffer = [];
  }

  async close() {
    await this.flush();
    await writeWithBackpressure(this.stream, "\n]\n");

    this.stream.end();
    await once(this.stream, "finish");
  }
}

async function main() {
  const NUM_VOTERS_TO_GENERATE = 10;
  const BATCH_SIZE = 10000;
  const ELECTION_ID = "ELC2026";

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const dataDir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const outputDbJsonPath = path.join(
    dataDir,
    `voter_data_for_db_${NUM_VOTERS_TO_GENERATE}.json`,
  );

  const outputScriptJsonPath = path.join(
    dataDir,
    `voter_secrets_for_script_${NUM_VOTERS_TO_GENERATE}.json`,
  );

  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();
  const F = eddsa.babyJub.F;

  const elecBytes = Array.from(ELECTION_ID).map((c) => BigInt(c.charCodeAt(0)));

  const electionHashFp = poseidon(elecBytes);
  const election_hash = F.toObject(electionHashFp).toString();

  const dbWriter = new JsonArrayBatchWriter(outputDbJsonPath, BATCH_SIZE);
  const secretWriter = new JsonArrayBatchWriter(
    outputScriptJsonPath,
    BATCH_SIZE,
  );

  await dbWriter.start();
  await secretWriter.start();

  console.log(`Generating data for ${NUM_VOTERS_TO_GENERATE} voters...`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  for (let i = 0; i < NUM_VOTERS_TO_GENERATE; i++) {
    const { pkHex: pk_secp } = generateSecpKeys();

    const { sk: sk_bjj, pk: pk_bjj } = generateBabyJubJubKeys(eddsa);

    const pk_bjj_bigint = [BigInt(pk_bjj[0]), BigInt(pk_bjj[1])];

    const hashedKeyFp = poseidon(pk_bjj_bigint);
    const hashedKey = F.toObject(hashedKeyFp).toString();

    const nullifierInputs = [BigInt(sk_bjj), BigInt(election_hash)];

    const nullifierFp = poseidon(nullifierInputs);
    const nullifier = F.toObject(nullifierFp).toString();

    const voterEntry_DB = {
      hashed_key: hashedKey,
      election_id: ELECTION_ID,
      is_valid: true,
      pk_secp,
    };

    const voterEntry_Secret = {
      hashed_key: hashedKey,
      sk_bjj,
      pk_bjj,
      pk_secp,
      nullifier,
      election_hash,
    };

    await dbWriter.push(voterEntry_DB);
    await secretWriter.push(voterEntry_Secret);

    if ((i + 1) % BATCH_SIZE === 0) {
      console.log(`Generated ${i + 1}/${NUM_VOTERS_TO_GENERATE}`);
    }
  }

  await dbWriter.close();
  await secretWriter.close();
}

main().catch((err) => {
  console.error("Fail:", err);
  process.exit(1);
});
