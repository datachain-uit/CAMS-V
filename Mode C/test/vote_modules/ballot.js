const crypto = require("crypto");
const { ethers } = require("hardhat");

function hashElectionId(poseidon, value) {
  const F = poseidon.F;
  const chars = Array.from(value).map((char) => BigInt(char.charCodeAt(0)));
  return F.toObject(poseidon(chars)).toString();
}

function pickRandomChoices(numCandidates, numSelections) {
  if (numSelections > numCandidates) {
    throw new Error("numSelections cannot be greater than numCandidates");
  }

  const indices = Array.from({ length: numCandidates }, (_, i) => i);

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, numSelections);
}

async function encryptVote(
  babyjub,
  publicKeyX,
  publicKeyY,
  numCandidates,
  selectedChoices,
) {
  const F = babyjub.F;
  const G = babyjub.Base8;
  const n = babyjub.subOrder;
  const publicKey = [F.e(publicKeyX), F.e(publicKeyY)];

  const messages = Array(numCandidates).fill(0n);
  for (const idx of selectedChoices) {
    if (idx < 0 || idx >= numCandidates) {
      throw new Error(`Invalid selected choice index: ${idx}`);
    }
    messages[idx] = 1n;
  }

  const randomness = Array.from({ length: numCandidates }, () => {
    const randomBytes = crypto.randomBytes(32);
    return BigInt(`0x${randomBytes.toString("hex")}`) % n;
  });

  const C1x = [];
  const C1y = [];
  const C2x = [];
  const C2y = [];

  for (let i = 0; i < numCandidates; i++) {
    const C1 = babyjub.mulPointEscalar(G, randomness[i]);
    const rPK = babyjub.mulPointEscalar(publicKey, randomness[i]);
    const mG = babyjub.mulPointEscalar(G, messages[i]);
    const C2 = babyjub.addPoint(mG, rPK);

    C1x.push(F.toObject(C1[0]).toString());
    C1y.push(F.toObject(C1[1]).toString());
    C2x.push(F.toObject(C2[0]).toString());
    C2y.push(F.toObject(C2[1]).toString());
  }

  return {
    m: messages.map(String),
    r: randomness.map(String),
    C1x,
    C1y,
    C2x,
    C2y,
  };
}

function buildVotePayload({ nullifier, hashCipherAll, cid }) {
  return {
    nullifier: ethers.zeroPadValue(ethers.toBeHex(BigInt(nullifier)), 32),
    hashCipherAll: ethers.zeroPadValue(
      ethers.toBeHex(BigInt(hashCipherAll)),
      32,
    ),
    cid,
  };
}

module.exports = {
  hashElectionId,
  pickRandomChoices,
  encryptVote,
  buildVotePayload,
};
