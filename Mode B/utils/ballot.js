"use strict";

const { buildPoseidon } = require("circomlibjs");

const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function fieldValue(value) {
  const n = BigInt(value);
  if (n < 0n || n >= FIELD) throw new Error("Noncanonical field value");
  return n;
}

function hashElectionId(poseidon, id) {
  return poseidon.F.toObject(
    poseidon(Array.from(id).map((c) => BigInt(c.charCodeAt(0)))),
  ).toString();
}

function hashCiphertext(poseidon, ballot, candidateCount) {
  const names = ["C1x", "C1y", "C2x", "C2y"];
  for (const name of names) {
    if (
      !Array.isArray(ballot[name]) ||
      ballot[name].length !== candidateCount
    ) {
      throw new Error("Invalid ciphertext dimensions");
    }
  }
  const H = (values) => poseidon.F.toObject(poseidon(values));
  let acc = 0n;
  for (let i = 0; i < candidateCount; i++) {
    const hash = H(names.map((name) => fieldValue(ballot[name][i])));
    acc = H([acc, hash]);
  }
  return acc;
}

function toSolidityProof(proof) {
  return {
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pC: [proof.pi_c[0], proof.pi_c[1]],
  };
}

async function createVoteSubmitter(votingContract, fetchBallot) {
  const poseidon = await buildPoseidon();
  return async function submitVoteOnChain(proof, publicSignals, voteData) {
    if (!Array.isArray(publicSignals) || publicSignals.length !== 6) {
      throw new Error("Rebuild VoteProofCombined: expected 6 public signals");
    }
    const nullifier =
      "0x" + fieldValue(voteData.nullifier).toString(16).padStart(64, "0");
    if (await votingContract.isNullifierUsed(nullifier)) {
      return { code: 2, gasUsed: 0n };
    }
    const ballot = await fetchBallot(voteData.ipfs_cid);
    const count = Number(await votingContract.getCandidateCount());
    if (
      hashCiphertext(poseidon, ballot, count) !== fieldValue(publicSignals[1])
    ) {
      throw new Error("CID ciphertext does not match proof");
    }
    const { pA, pB, pC } = toSolidityProof(proof);
    const hashCipher =
      "0x" + fieldValue(voteData.hashCipherAll).toString(16).padStart(64, "0");
    const tx = await votingContract.submitVoteWithProof(
      pA,
      pB,
      pC,
      publicSignals,
      nullifier,
      hashCipher,
      voteData.ipfs_cid,
    );
    const receipt = await tx.wait();
    return { code: 0, gasUsed: receipt.gasUsed ?? 0n };
  };
}

module.exports = {
  hashElectionId,
  hashCiphertext,
  toSolidityProof,
  createVoteSubmitter,
};
