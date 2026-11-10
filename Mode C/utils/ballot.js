"use strict";

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

module.exports = {
  fieldValue,
  hashElectionId,
  hashCiphertext,
  toSolidityProof,
};
