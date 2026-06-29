// const fs = require("fs");
// const path = require("path");
// const { spawnSync } = require("child_process");

// function run(cmd, args, opts = {}) {
//   console.log(`\n$ ${cmd} ${args.join(" ")}`);
//   const r = spawnSync(cmd, args, {
//     stdio: "inherit",
//     shell: process.platform === "win32",
//     ...opts,
//   });
//   if (r.status !== 0) {
//     throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
//   }
// }

// function ensureFile(p) {
//   if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
// }

// function ensureDir(p) {
//   fs.mkdirSync(p, { recursive: true });
// }

// function buildOneCircuit({ circuitName, circuitsDir, buildRoot, ptauPath, isTallyValidity }) {
//   const circuitFile = path.join(circuitsDir, `${circuitName}.circom`);
//   ensureFile(circuitFile);
//   ensureFile(ptauPath);

//   const outDir = path.join(buildRoot, circuitName);
//   ensureDir(outDir);

//   const r1cs = path.join(outDir, `${circuitName}.r1cs`);
//   const sym = path.join(outDir, `${circuitName}.sym`);
//   const wasm = path.join(outDir, `${circuitName}_js`, `${circuitName}.wasm`);

//   const zkey0 = path.join(outDir, `${circuitName}_0000.zkey`);
//   const zkey = path.join(outDir, `${circuitName}.zkey`);
//   const vkey = path.join(outDir, `${circuitName}_vkey.json`);

//   run("circom", [
//     circuitFile,
//     "--r1cs",
//     "--wasm",
//     "--sym",
//     "-l",
//     "node_modules",
//     "-l",
//     circuitsDir,
//     "-o",
//     outDir,
//   ]);

//   ensureFile(r1cs);
//   ensureFile(sym);
//   ensureFile(wasm);

//   run("npx", ["snarkjs", "r1cs", "info", r1cs]);

//   run("npx", ["snarkjs", "groth16", "setup", r1cs, ptauPath, zkey0]);
//   ensureFile(zkey0);

//   const entropy =
//     process.env.ZKEY_ENTROPY || `${circuitName}-${Date.now()}`;

//   run("npx", [
//     "snarkjs",
//     "zkey",
//     "contribute",
//     zkey0,
//     zkey,
//     "--name=key1",
//     "-v",
//     `-e=${entropy}`,
//   ]);
//   ensureFile(zkey);

//   run("npx", ["snarkjs", "zkey", "export", "verificationkey", zkey, vkey]);
//   ensureFile(vkey);

//   run("npx", ["snarkjs", "zkey", "verify", r1cs, ptauPath, zkey]);

//   if (isTallyValidity) {
//     const solFile = path.join(outDir, `${circuitName}Verifier.sol`);
//     run("npx", [
//   "snarkjs",
//   "zkey",
//   "export",
//   "solidityverifier",
//   zkey,
//   solFile,
// ]);
//     ensureFile(solFile);

//     let solContent = fs.readFileSync(solFile, "utf8");
//     solContent = solContent.replace(/contract Groth16Verifier/, "contract TallyValidityVerifier");

//     fs.writeFileSync(solFile, solContent, "utf8");
//     console.log(`Solidity contract exported as ${circuitName}Verifier.sol`);
//   }

//   return { outDir, wasm, zkey, vkey, r1cs };
// }

// function parseArgs() {
//   const circuitsDir = process.env.CIRCUITS_DIR || "circuits";
//   const buildRoot = process.env.BUILD_DIR || path.join("circuits", "build");
//   const ptauPath =
//     process.env.PTAU ||
//     path.join("circuits", "powersOfTau28_hez_final_16.ptau");

//   const circuits = process.argv.slice(2);
//   const isTallyValidity = circuits.includes("TallyValidity");

//   if (circuits.length === 0) {
//     circuits.push("TallyValidity");
//   }

//   return { circuitsDir, buildRoot, ptauPath, circuits, isTallyValidity };
// }

// async function main() {
//   const { circuitsDir, buildRoot, ptauPath, circuits, isTallyValidity } = parseArgs();

//   ensureDir(buildRoot);

//   for (const circuitName of circuits) {
//     buildOneCircuit({ circuitName, circuitsDir, buildRoot, ptauPath, isTallyValidity });
//   }
// }

// main().catch((e) => {
//   console.error("\nERROR:", e.message || e);
//   process.exit(1);
// });

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function ensureFile(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function buildOneCircuit({
  circuitName,
  circuitsDir,
  buildRoot,
  contractsDir,
  ptauPath,
}) {
  const circuitFile = path.join(circuitsDir, `${circuitName}.circom`);
  ensureFile(circuitFile);
  ensureFile(ptauPath);

  const outDir = path.join(buildRoot, circuitName);
  ensureDir(outDir);
  ensureDir(contractsDir);

  const r1cs = path.join(outDir, `${circuitName}.r1cs`);
  const sym = path.join(outDir, `${circuitName}.sym`);
  const wasm = path.join(outDir, `${circuitName}_js`, `${circuitName}.wasm`);

  const zkey0 = path.join(outDir, `${circuitName}_0000.zkey`);
  const zkey = path.join(outDir, `${circuitName}.zkey`);
  const vkey = path.join(outDir, `${circuitName}_vkey.json`);

  run("circom", [
    circuitFile,
    "--r1cs",
    "--wasm",
    "--sym",
    "-l",
    "node_modules",
    "-l",
    circuitsDir,
    "-o",
    outDir,
  ]);

  ensureFile(r1cs);
  ensureFile(sym);
  ensureFile(wasm);

  run("npx", ["snarkjs", "r1cs", "info", r1cs]);

  run("npx", ["snarkjs", "groth16", "setup", r1cs, ptauPath, zkey0]);
  ensureFile(zkey0);

  const entropy = process.env.ZKEY_ENTROPY || `${circuitName}-${Date.now()}`;

  run("npx", [
    "snarkjs",
    "zkey",
    "contribute",
    zkey0,
    zkey,
    "--name=key1",
    "-v",
    `-e=${entropy}`,
  ]);
  ensureFile(zkey);

  run("npx", ["snarkjs", "zkey", "export", "verificationkey", zkey, vkey]);
  ensureFile(vkey);

  run("npx", ["snarkjs", "zkey", "verify", r1cs, ptauPath, zkey]);

  // if (circuitName === "TallyValidity") {
  //   const solFile = path.join(contractsDir, "TallyValidityVerifier.sol");

  //   run("npx", [
  //     "snarkjs",
  //     "zkey",
  //     "export",
  //     "solidityverifier",
  //     zkey,
  //     solFile,
  //   ]);
  //   ensureFile(solFile);

  //   let solContent = fs.readFileSync(solFile, "utf8");
  //   solContent = solContent.replace(
  //     /contract Groth16Verifier/,
  //     "contract TallyValidityVerifier"
  //   );

  //   fs.writeFileSync(solFile, solContent, "utf8");
  //   console.log(`Solidity contract exported to ${solFile}`);
  // }
  if (circuitName === "TallyValidity" || circuitName === "VoteProofCombined") {
    const solFile = path.join(contractsDir, `${circuitName}Verifier.sol`);

    run("npx", [
      "snarkjs",
      "zkey",
      "export",
      "solidityverifier",
      zkey,
      solFile,
    ]);
    ensureFile(solFile);

    let solContent = fs.readFileSync(solFile, "utf8");
    solContent = solContent.replace(
      /contract Groth16Verifier/,
      `contract ${circuitName}Verifier`,
    );

    fs.writeFileSync(solFile, solContent, "utf8");
    console.log(`Solidity contract exported to ${solFile}`);
  }

  return { outDir, wasm, zkey, vkey, r1cs };
}

function parseArgs() {
  const circuitsDir = process.env.CIRCUITS_DIR || "circuits";
  const buildRoot = process.env.BUILD_DIR || path.join("circuits", "build");
  const contractsDir = process.env.CONTRACTS_DIR || "contracts";
  const ptauPath =
    process.env.PTAU ||
    path.join("circuits", "powersOfTau28_hez_final_17.ptau");

  const circuits = process.argv.slice(2);

  if (circuits.length === 0) {
    circuits.push("TallyValidity");
  }

  return { circuitsDir, buildRoot, contractsDir, ptauPath, circuits };
}

async function main() {
  const { circuitsDir, buildRoot, contractsDir, ptauPath, circuits } =
    parseArgs();

  ensureDir(buildRoot);
  ensureDir(contractsDir);

  for (const circuitName of circuits) {
    buildOneCircuit({
      circuitName,
      circuitsDir,
      buildRoot,
      contractsDir,
      ptauPath,
    });
  }
}

main().catch((e) => {
  console.error("\nERROR:", e.message || e);
  process.exit(1);
});
