"use strict";

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { createTrusteeApprover } = require("../utils/voteApproval");
const { fetchBallotFromIPFS } = require("../utils/ipfs");
const { getContract } = require("../configs/blockchain");

const id = Number(process.env.TRUSTEE_ID);

if (!Number.isInteger(id) || id < 1) {
  throw new Error("Missing TRUSTEE_ID");
}

const VKEY_PATH = path.join(
  __dirname,
  "../circuits/build/VoteProofCombined/VoteProofCombined_vkey.json",
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let approve;

const queue = [];
let processing = false;

async function handle({ packet, profile }) {
  if (profile.behavior === "OFFLINE") {
    return { status: "NO_RESPONSE" };
  }

  if (profile.delayMs > 0) {
    await sleep(profile.delayMs);
  }

  if (profile.behavior === "REFUSE") {
    return { status: "REFUSED" };
  }

  const timings = {
    verifyTimeMs: null,
    digestTimeMs: null,
    signTimeMs: null,
    processingTimeMs: null,
  };

  const processingStart = performance.now();

  try {
    const signature = await approve(packet, timings);

    return {
      status: "APPROVED",
      signature,
      ...timings,
      processingTimeMs: performance.now() - processingStart,
    };
  } catch (err) {
    return {
      status: "REJECTED",
      error: err.message,
      ...timings,
      processingTimeMs: performance.now() - processingStart,
    };
  }
}

async function drain() {
  if (processing) return;

  processing = true;

  try {
    while (queue.length) {
      const message = queue.shift();
      const result = await handle(message);

      if (process.connected) {
        process.send({
          type: "RESPONSE",
          requestId: message.requestId,
          result,
        });
      }
    }
  } finally {
    processing = false;
  }
}

async function boot() {
  const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

  const { signer, votingContract } = await getContract(id);
  approve = await createTrusteeApprover(
    votingContract,
    signer,
    vKey,
    fetchBallotFromIPFS,
  );

  process.on("message", (message) => {
    if (message.type !== "REQUEST") return;

    if (message.profile.behavior === "OFFLINE") return;

    queue.push(message);

    drain().catch((err) => {
      if (process.connected) {
        process.send({
          type: "RESPONSE",
          requestId: message.requestId,
          result: {
            status: "ERROR",
            error: err.message,
          },
        });
      }
    });
  });

  process.send({ type: "READY", id });
}

boot().catch((err) => {
  if (process.connected) {
    process.send({
      type: "STARTUP_ERROR",
      error: err.stack || err.message,
    });
  }

  process.exitCode = 1;
});
