"use strict";

const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const { groth16 } = require("snarkjs");

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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
    if (!Array.isArray(ballot[name]) || ballot[name].length !== candidateCount) {
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

// The CA trusts its locally installed vkey, and reads election parameters from
// the configured contract. Neither is supplied by the ballot request.
async function createVoteSubmitter(votingContract, vKey, fetchBallot) {
  if (vKey.nPublic !== 6) throw new Error("Rebuild VoteProofCombined: expected 6 public signals");
  const poseidon = await buildPoseidon();
  const babyjub = await buildBabyjub();

  return async function submitVoteLocal(proof, publicSignals, voteData) {
    let info, signals, nullifier;
    try {
      if (!Array.isArray(publicSignals) || publicSignals.length !== 6) {
        throw new Error("Expected 6 public signals");
      }
      signals = publicSignals.map(fieldValue);
      info = await votingContract.info();
      const [electionHash, x, y] = await Promise.all([
        votingContract.electionHash(), votingContract.epkX(), votingContract.epkY(),
      ]);
      if (BigInt(info.status) !== 1n || voteData.election_id !== info.electionId) {
        throw new Error("Election mismatch or inactive");
      }
      if (BigInt(hashElectionId(poseidon, info.electionId)) !== BigInt(electionHash)) {
        throw new Error("Election hash does not match election ID");
      }
      const expected = [BigInt(info.merkleRoot), BigInt(electionHash), BigInt(x), BigInt(y)];
      if (expected.some((value, i) => signals[i + 2] !== value)) {
        throw new Error("Election public inputs mismatch");
      }
      const pk = [babyjub.F.e(x), babyjub.F.e(y)];
      if (!babyjub.inSubgroup(pk) || (BigInt(x) === 0n && BigInt(y) === 1n)) {
        throw new Error("Invalid election public key");
      }
      if (signals[0] !== fieldValue(voteData.nullifier)) {
        throw new Error("Nullifier does not match payload");
      }
      if (!await groth16.verify(vKey, publicSignals, proof)) {
        throw new Error("Invalid vote proof");
      }
      // Bind the actual content addressed by the CID to the proof's hash.
      // Merely making an unrelated cid_hash public would not establish this.
      const ballot = await fetchBallot(voteData.ipfs_cid);
      const candidateCount = Number(await votingContract.getCandidateCount());
      if (hashCiphertext(poseidon, ballot, candidateCount) !== signals[1]) {
        throw new Error("CID ciphertext does not match proof");
      }
      nullifier = "0x" + signals[0].toString(16).padStart(64, "0");
    } catch (error) {
      return { code: 1, gasUsed: 0n, reason: error.message };
    }

    if (await votingContract.isNullifierUsed(nullifier)) {
      return { code: 2, gasUsed: 0n };
    }
    const hashCipher = "0x" + signals[1].toString(16).padStart(64, "0");
    const tx = await votingContract.submitVote(nullifier, hashCipher, voteData.ipfs_cid);
    const receipt = await tx.wait();
    return { code: 0, gasUsed: receipt.gasUsed ?? 0n };
  };
}

module.exports = { createVoteSubmitter, hashElectionId, hashCiphertext };
