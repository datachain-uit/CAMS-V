const fs = require("fs");
const path = require("path");
const { groth16, wtns } = require("snarkjs");
const { performance } = require("perf_hooks");
const { ensureDir } = require("./output");

async function generateWitnessAndProof(
  witnessInput,
  voterId,
  index,
  { witnessDir, wasmPath, zkeyPath },
) {
  ensureDir(witnessDir);

  const witnessFile = path.join(
    witnessDir,
    `vote_${index}_${String(voterId)}.wtns`,
  );

  const witnessStart = performance.now();
  await wtns.calculate(witnessInput, wasmPath, witnessFile);
  const witnessEnd = performance.now();
  const witnessTimeMs = witnessEnd - witnessStart;

  const proofStart = performance.now();
  const { proof, publicSignals } = await groth16.prove(zkeyPath, witnessFile);
  const proofEnd = performance.now();
  const proofGenerationTimeMs = proofEnd - proofStart;

  try {
    fs.unlinkSync(witnessFile);
  } catch (_) {}

  return {
    proof,
    publicSignals,
    witnessTimeMs,
    proofGenerationTimeMs,
  };
}

module.exports = { generateWitnessAndProof };
