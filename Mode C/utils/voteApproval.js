"use strict";

const { performance } = require("node:perf_hooks");
const { ethers } = require("hardhat");
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const { groth16 } = require("snarkjs");
const { fieldValue, hashElectionId, hashCiphertext } = require("./ballot");

// Each trustee uses its own trusted local vkey and reads the official election
// configuration from its contract, never from the request or CA.
async function createTrusteeApprover(
  votingContract,
  signer,
  vKey,
  fetchBallot,
) {
  if (vKey.nPublic !== 6) {
    throw new Error("Rebuild VoteProofCombined: expected 6 public signals");
  }
  const poseidon = await buildPoseidon();
  const babyjub = await buildBabyjub();
  const trustee = await signer.getAddress();

  return async function approve(packet, timings = {}) {
    const verifyStart = performance.now();
    try {
      if (
        !packet ||
        !Array.isArray(packet.publicSignals) ||
        packet.publicSignals.length !== 6 ||
        !packet.votePayload
      ) {
        throw new Error("Invalid ballot packet: expected 6 public signals");
      }
      const signals = packet.publicSignals.map(fieldValue);
      const { nullifier, hashCipherAll, cid } = packet.votePayload;
      if (
        !ethers.isHexString(nullifier, 32) ||
        !ethers.isHexString(hashCipherAll, 32)
      ) {
        throw new Error("Invalid ballot payload bytes32 fields");
      }
      if (
        signals[0] !== fieldValue(nullifier) ||
        signals[1] !== fieldValue(hashCipherAll)
      ) {
        throw new Error("Proof outputs do not match ballot payload");
      }
      if (
        typeof cid !== "string" ||
        !cid.startsWith("ipfs://") ||
        cid.length <= 7
      ) {
        throw new Error("Expected ipfs:// CID");
      }
      const [info, configured, electionHash, x, y, count, registered, used] =
        await Promise.all([
          votingContract.info(),
          votingContract.cryptoParamsConfigured(),
          votingContract.electionHash(),
          votingContract.epkX(),
          votingContract.epkY(),
          votingContract.getCandidateCount(),
          votingContract.isTrustee(trustee),
          votingContract.isNullifierUsed(nullifier),
        ]);
      if (!configured || BigInt(info.status) !== 1n) {
        throw new Error("Election inactive or not configured");
      }
      if (!registered) throw new Error("Signer not trustee");
      if (used) throw new Error("Double vote detected");
      if (
        BigInt(hashElectionId(poseidon, info.electionId)) !==
        BigInt(electionHash)
      ) {
        throw new Error("Election hash does not match election ID");
      }
      const expected = [
        BigInt(info.merkleRoot),
        BigInt(electionHash),
        BigInt(x),
        BigInt(y),
      ];
      if (expected.some((value, i) => signals[i + 2] !== value)) {
        throw new Error("Election public inputs mismatch");
      }
      const pk = [babyjub.F.e(x), babyjub.F.e(y)];
      if (!babyjub.inSubgroup(pk) || (BigInt(x) === 0n && BigInt(y) === 1n)) {
        throw new Error("Invalid election public key");
      }
      if (!(await groth16.verify(vKey, packet.publicSignals, packet.proof))) {
        throw new Error("Invalid Groth16 proof");
      }
      const ballot = await fetchBallot(cid);
      if (hashCiphertext(poseidon, ballot, Number(count)) !== signals[1]) {
        throw new Error("CID ciphertext does not match proof");
      }
    } finally {
      // Includes official configuration and CID validation before approval.
      timings.verifyTimeMs = performance.now() - verifyStart;
    }

    const { nullifier, hashCipherAll, cid } = packet.votePayload;
    const digestStart = performance.now();
    let digest;
    try {
      digest = await votingContract.getVoteApprovalDigest(
        nullifier,
        hashCipherAll,
        cid,
      );
    } finally {
      timings.digestTimeMs = performance.now() - digestStart;
    }
    const signStart = performance.now();
    try {
      return await signer.signMessage(ethers.getBytes(digest));
    } finally {
      timings.signTimeMs = performance.now() - signStart;
    }
  };
}

module.exports = { createTrusteeApprover };
