const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function ensureFile(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing file: ${p}`);
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function runCapture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });

  if (res.status !== 0) {
    const stderr = res.stderr || "";
    const stdout = res.stdout || "";
    throw new Error(
      `Command failed: ${cmd} ${args.join(" ")}\n${stdout}\n${stderr}`,
    );
  }

  return {
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function runInherit(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });

  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function fileSizeBytes(p) {
  return fs.statSync(p).size;
}

function bytesToMB(bytes) {
  return bytes / 1024 / 1024;
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function appendCsvRow(csvPath, row) {
  const header =
    "circuit,compile_time_s,compile_size_mb,zkey_time_s,zkey_size_mb,export_time_s,export_size_mb,total_time_s,total_size_mb,constraints\n";

  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, header, "utf8");
  }

  fs.appendFileSync(
    csvPath,
    [
      row.circuit,
      row.compile_time_s,
      row.compile_size_mb,
      row.zkey_time_s,
      row.zkey_size_mb,
      row.export_time_s,
      row.export_size_mb,
      row.total_time_s,
      row.total_size_mb,
      row.constraints,
    ].join(",") + "\n",
    "utf8",
  );
}

function extractConstraints(r1csInfoOutput) {
  const patterns = [
    /# of Constraints:\s*([0-9]+)/i,
    /constraints:\s*([0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = r1csInfoOutput.match(pattern);
    if (match) return Number(match[1]);
  }

  throw new Error(
    "Could not extract constraints from snarkjs r1cs info output.",
  );
}

function parseArgs() {
  const circuitsDir = process.env.CIRCUITS_DIR || "circuits";
  const buildRoot = process.env.BUILD_DIR || path.join("circuits", "build");
  const contractsDir = process.env.CONTRACTS_DIR || "contracts";
  const ptauPath =
    process.env.PTAU ||
    path.join("circuits", "powersOfTau28_hez_final_16.ptau");
  const metricsDir = process.env.METRICS_DIR || path.join("data", "metrics");

  const circuits = process.argv.slice(2);
  if (circuits.length === 0) {
    circuits.push("TallyValidity");
  }

  return {
    circuitsDir,
    buildRoot,
    contractsDir,
    ptauPath,
    metricsDir,
    circuits,
  };
}

function buildPaths(circuitName, circuitsDir, buildRoot, contractsDir) {
  const outDir = path.join(buildRoot, circuitName);

  return {
    circuitFile: path.join(circuitsDir, `${circuitName}.circom`),
    outDir,
    r1cs: path.join(outDir, `${circuitName}.r1cs`),
    sym: path.join(outDir, `${circuitName}.sym`),
    wasm: path.join(outDir, `${circuitName}_js`, `${circuitName}.wasm`),
    zkey0: path.join(outDir, `${circuitName}_0000.zkey`),
    zkey: path.join(outDir, `${circuitName}.zkey`),
    vkey: path.join(outDir, `${circuitName}_vkey.json`),
    sol: path.join(contractsDir, `${circuitName}Verifier.sol`),
  };
}

function measureOneCircuit({
  circuitName,
  circuitsDir,
  buildRoot,
  contractsDir,
  ptauPath,
  metricsDir,
}) {
  const paths = buildPaths(circuitName, circuitsDir, buildRoot, contractsDir);

  ensureFile(paths.circuitFile);
  ensureFile(ptauPath);
  ensureDir(paths.outDir);
  ensureDir(contractsDir);
  ensureDir(metricsDir);

  console.log(`\n==============================`);
  console.log(`Measuring circuit: ${circuitName}`);
  console.log(`==============================`);

  // 1) Compile artifacts
  const tCompileStart = nowMs();
  runInherit("circom", [
    paths.circuitFile,
    "--r1cs",
    "--wasm",
    "--sym",
    "-l",
    "node_modules",
    "-l",
    circuitsDir,
    "-o",
    paths.outDir,
  ]);
  const tCompileEnd = nowMs();

  ensureFile(paths.r1cs);
  ensureFile(paths.sym);
  ensureFile(paths.wasm);

  const compileTimeSec = (tCompileEnd - tCompileStart) / 1000;
  const compileSizeBytes =
    fileSizeBytes(paths.r1cs) +
    fileSizeBytes(paths.sym) +
    fileSizeBytes(paths.wasm);

  // constraints
  const r1csInfo = runCapture("npx", ["snarkjs", "r1cs", "info", paths.r1cs]);
  const constraints = extractConstraints(r1csInfo.stdout + "\n" + r1csInfo.stderr);

  // 2) Proving key (.zkey)
  const entropy = process.env.ZKEY_ENTROPY || `${circuitName}-${Date.now()}`;

  const tZkeyStart = nowMs();
  runInherit("npx", [
    "snarkjs",
    "groth16",
    "setup",
    paths.r1cs,
    ptauPath,
    paths.zkey0,
  ]);
  ensureFile(paths.zkey0);

  runInherit("npx", [
    "snarkjs",
    "zkey",
    "contribute",
    paths.zkey0,
    paths.zkey,
    "--name=key1",
    "-v",
    `-e=${entropy}`,
  ]);
  const tZkeyEnd = nowMs();

  ensureFile(paths.zkey);
  const zkeyTimeSec = (tZkeyEnd - tZkeyStart) / 1000;
  const zkeySizeBytes = fileSizeBytes(paths.zkey);

  // export verification key json separately if needed
  runInherit("npx", [
    "snarkjs",
    "zkey",
    "export",
    "verificationkey",
    paths.zkey,
    paths.vkey,
  ]);
  ensureFile(paths.vkey);

  // 3) Export verifier
  const tExportStart = nowMs();
  runInherit("npx", [
    "snarkjs",
    "zkey",
    "export",
    "solidityverifier",
    paths.zkey,
    paths.sol,
  ]);
  const tExportEnd = nowMs();

  ensureFile(paths.sol);

  let solContent = fs.readFileSync(paths.sol, "utf8");
  solContent = solContent.replace(
    /contract Groth16Verifier/,
    `contract ${circuitName}Verifier`,
  );
  fs.writeFileSync(paths.sol, solContent, "utf8");

  const exportTimeSec = (tExportEnd - tExportStart) / 1000;
  const exportSizeBytes = fileSizeBytes(paths.sol);

  // total
  const totalTimeSec = compileTimeSec + zkeyTimeSec + exportTimeSec;
  const totalSizeBytes =
    compileSizeBytes + zkeySizeBytes + exportSizeBytes;

  const result = {
    circuit: circuitName,
    compile_time_s: round(compileTimeSec),
    compile_size_mb: round(bytesToMB(compileSizeBytes)),
    zkey_time_s: round(zkeyTimeSec),
    zkey_size_mb: round(bytesToMB(zkeySizeBytes)),
    export_time_s: round(exportTimeSec),
    export_size_mb: round(bytesToMB(exportSizeBytes), 6),
    total_time_s: round(totalTimeSec),
    total_size_mb: round(bytesToMB(totalSizeBytes)),
    constraints,
    paths,
  };

  const jsonPath = path.join(metricsDir, `${circuitName}_setup_metrics.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");

  const csvPath = path.join(metricsDir, "circuit_setup_metrics.csv");
  appendCsvRow(csvPath, result);

  console.log(`\n----- Result: ${circuitName} -----`);
  console.log(
    `Compile artifacts: ${result.compile_time_s} s | ${result.compile_size_mb} MB`,
  );
  console.log(
    `Proving key (.zkey): ${result.zkey_time_s} s | ${result.zkey_size_mb} MB`,
  );
  console.log(
    `Export verifier: ${result.export_time_s} s | ${result.export_size_mb} MB`,
  );
  console.log(`Total: ${result.total_time_s} s | ${result.total_size_mb} MB`);
  console.log(`Constraints: ${result.constraints}`);
  console.log(`JSON saved: ${jsonPath}`);
  console.log(`CSV saved: ${csvPath}`);

  console.log("\nMarkdown row (time):");
  console.log(
    `| ${circuitName} | ${result.compile_time_s} | ${result.zkey_time_s} | ${result.export_time_s} | ${result.total_time_s} | ${result.constraints} |`,
  );

  console.log("\nMarkdown row (size):");
  console.log(
    `| ${circuitName} | ${result.compile_size_mb} | ${result.zkey_size_mb} | ${result.export_size_mb} | ${result.total_size_mb} |`,
  );

  return result;
}

function main() {
  const { circuitsDir, buildRoot, contractsDir, ptauPath, metricsDir, circuits } =
    parseArgs();

  ensureDir(buildRoot);
  ensureDir(contractsDir);
  ensureDir(metricsDir);

  for (const circuitName of circuits) {
    measureOneCircuit({
      circuitName,
      circuitsDir,
      buildRoot,
      contractsDir,
      ptauPath,
      metricsDir,
    });
  }
}

try {
  main();
} catch (error) {
  console.error("\nERROR:", error.message || error);
  process.exit(1);
}