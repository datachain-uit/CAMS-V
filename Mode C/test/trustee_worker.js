"use strict";

// Each trustee has its own Node.js process, signer, event loop and proof verifier.
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
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

let signer, votingContract, vKey;

const queue = [];
let processing = false;

// Ensure a valid proof cannot be reused to approve
// a different ballot payload.
function assertProofMatchesPayload(packet) {
  if (
    !packet ||
    !Array.isArray(packet.publicSignals) ||
    packet.publicSignals.length !== 2 ||
    !packet.votePayload
  ) {
    throw new Error("Invalid ballot packet structure");
  }

  const { nullifier, hashCipherAll } = packet.votePayload;

  if (
    !ethers.isHexString(nullifier, 32) ||
    !ethers.isHexString(hashCipherAll, 32)
  ) {
    throw new Error("Invalid ballot payload bytes32 fields");
  }

  const proofNullifier = ethers.toBeHex(BigInt(packet.publicSignals[0]), 32);

  const proofHashCipher = ethers.toBeHex(BigInt(packet.publicSignals[1]), 32);

  if (proofNullifier.toLowerCase() !== nullifier.toLowerCase()) {
    throw new Error("Proof nullifier does not match ballot payload");
  }

  if (proofHashCipher.toLowerCase() !== hashCipherAll.toLowerCase()) {
    throw new Error("Proof hashCipherAll does not match ballot payload");
  }
}

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

  // Measurements are monotonic and local to this worker process.
  const timings = {
    verifyTimeMs: null,
    digestTimeMs: null,
    signTimeMs: null,
    processingTimeMs: null,
  };

  const processingStart = performance.now();

  try {
    const verifyStart = performance.now();
    let valid;

    try {
      valid = await groth16.verify(vKey, packet.publicSignals, packet.proof);
    } finally {
      timings.verifyTimeMs = performance.now() - verifyStart;
    }

    if (!valid) {
      return {
        status: "REJECTED",
        error: "Invalid Groth16 proof",
        ...timings,
        processingTimeMs: performance.now() - processingStart,
      };
    }

    // SECURITY:
    // The proof's public signals must match the exact
    // ballot payload that the trustee is about to approve.
    assertProofMatchesPayload(packet);

    // The Solidity digest includes:
    // electionId, merkleRoot, nullifier, hashCipherAll,
    // hash(CID), chainId, contract address.
    const digestStart = performance.now();
    let digest;

    try {
      digest = await votingContract.getVoteApprovalDigest(
        packet.votePayload.nullifier,
        packet.votePayload.hashCipherAll,
        packet.votePayload.cid,
      );
    } finally {
      timings.digestTimeMs = performance.now() - digestStart;
    }

    const signStart = performance.now();
    let signature;

    try {
      signature = await signer.signMessage(ethers.getBytes(digest));
    } finally {
      timings.signTimeMs = performance.now() - signStart;
    }

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
  vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

  ({ signer, votingContract } = await getContract(id));

  process.on("message", (message) => {
    if (message.type !== "REQUEST") return;

    // Simulate an unresponsive trustee.
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
