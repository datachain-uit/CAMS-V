"use strict";

// Run after: node scripts/circom.js VoteProofCombined
// Then: npx hardhat run scripts/test_r1.js (uses an ephemeral local chain).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { ethers } = require("hardhat");
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const { groth16 } = require("snarkjs");
const {
  createVoteSubmitter,
  hashElectionId,
  toSolidityProof,
} = require("../utils/ballot");

const rootDir = path.resolve(__dirname, "..");
const build = path.join(rootDir, "circuits/build/VoteProofCombined");
const wasm = path.join(build, "VoteProofCombined_js/VoteProofCombined.wasm");
const zkey = path.join(build, "VoteProofCombined.zkey");
const read = (file) => fs.readFileSync(file, "utf8");
const bytes32 = (n) => ethers.toBeHex(BigInt(n), 32);

async function main() {
  const vkey = JSON.parse(
    read(path.join(build, "VoteProofCombined_vkey.json")),
  );
  assert.equal(vkey.nPublic, 6, "Build the fixed circuit before running tests");
  const sym = read(path.join(build, "VoteProofCombined.sym"));
  const depth = [...sym.matchAll(/,main\.pathElements\[(\d+)\]/g)].length;
  assert.equal(
    [...sym.matchAll(/,main\.m\[(\d+)\]/g)].length,
    2,
    "Test fixture expects 2 candidates",
  );
  const bj = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = bj.F;
  const H = (values) => poseidon.F.toObject(poseidon(values));
  const coords = (p) => p.map((v) => F.toObject(v).toString());
  const secretKey = 4567n;
  const PK = bj.mulPointEscalar(bj.Base8, secretKey);
  const [x, y] = coords(PK);
  const electionHash = hashElectionId(poseidon, "ELC2026");
  function voter(sk) {
    const hash_pk = H(coords(bj.mulPointEscalar(bj.Base8, sk)).map(BigInt));
    const pathElements = Array.from({ length: depth }, (_, i) =>
      BigInt(i + 101),
    );
    let root = hash_pk;
    for (const sibling of pathElements) root = H([root, sibling]);
    return {
      sk: String(sk),
      hash_pk: String(hash_pk),
      root: String(root),
      pathElements: pathElements.map(String),
      pathIndices: Array(depth).fill("0"),
    };
  }
  const registered = voter(12345n);
  function ballot(
    v = registered,
    election = electionHash,
    pk = PK,
    m = [1n, 0n],
  ) {
    const r = [7n, 11n];
    const ct = { C1x: [], C1y: [], C2x: [], C2y: [] };
    for (let i = 0; i < 2; i++) {
      const a = coords(bj.mulPointEscalar(bj.Base8, r[i]));
      const b = coords(
        bj.addPoint(
          bj.mulPointEscalar(bj.Base8, m[i]),
          bj.mulPointEscalar(pk, r[i]),
        ),
      );
      ct.C1x.push(a[0]);
      ct.C1y.push(a[1]);
      ct.C2x.push(b[0]);
      ct.C2y.push(b[1]);
    }
    const [PKx, PKy] = coords(pk);
    return {
      ...v,
      election_hash: String(election),
      PKx,
      PKy,
      m: m.map(String),
      r: r.map(String),
      ...ct,
    };
  }
  async function prove(input) {
    const result = await groth16.fullProve(input, wasm, zkey);
    assert.equal(
      await groth16.verify(vkey, result.publicSignals, result.proof),
      true,
    );
    return result;
  }

  const partial = await (await ethers.getContractFactory("PartialDecryptionVerifier")).deploy();
  const combined = await (await ethers.getContractFactory("VoteProofCombinedVerifier")).deploy();
  await partial.waitForDeployment();
  await combined.waitForDeployment();
  const contract = await (await ethers.getContractFactory("E_Voting")).deploy(partial.target, combined.target);
  await contract.waitForDeployment();
  const emptyProof = [[0, 0], [[0, 0], [0, 0]], [0, 0]];
  await assert.rejects(contract.startElection(), /Election not configured/);
  await (await contract.setElectionInfo("ELC2026", "R1 test", 0, 9999999999)).wait();
  await assert.rejects(contract.submitVoteWithProof(...emptyProof, [1, 2, 0, 0, 0, 0], bytes32(1), bytes32(2), "ipfs://test"), /Election not active/);
  await (await contract.setMerkleRoot(bytes32(registered.root))).wait();
  await (await contract.addCandidate("A")).wait();
  await (await contract.addCandidate("B")).wait();
  await assert.rejects(contract.startElection(), /Election not configured/);
  await (await contract.setElectionCryptoParams(electionHash, x, y)).wait();
  assert.equal(await contract.epk(), ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [x, y]));
  await (await contract.startElection()).wait();
  for (const change of [
    () => contract.setElectionInfo("other", "other", 0, 99),
    () => contract.setMerkleRoot(bytes32(2)),
    () => contract.addCandidate("C"),
    () => contract.setElectionCryptoParams(42, x, y),
    () => contract.publishEpk(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [x, y])),
  ]) await assert.rejects(change(), /Election configuration locked/);
  console.log("PASS: setup required; election ID/hash, root, key and candidates locked");

  function proofArgs(result) {
    const { pA, pB, pC } = toSolidityProof(result.proof);
    return [pA, pB, pC, result.publicSignals];
  }
  function send(result, signer = contract) {
    return signer.submitVoteWithProof(...proofArgs(result), bytes32(result.publicSignals[0]), bytes32(result.publicSignals[1]), "ipfs://fixture");
  }
  async function rejected(result, reason) {
    assert.equal(await combined.verifyProof(...proofArgs(result)), true);
    assert.equal(await contract.verifyVoteProofCombined(...proofArgs(result)), false);
    await assert.rejects(send(result), reason);
    assert.equal(await contract.isNullifierUsed(bytes32(result.publicSignals[0])), false);
  }
  const validInput = ballot();
  const valid = await prove(validInput);
  assert.deepEqual(valid.publicSignals.slice(2), [registered.root, electionHash, x, y]);
  const fakeRoot = await prove(ballot(voter(54321n)));
  await rejected(fakeRoot, /Merkle root mismatch/);
  console.log("PASS [1]: proof for self-made root verifies, contract rejects unofficial root");
  const otherElection = await prove(ballot(registered, BigInt(electionHash) + 1n));
  assert.notEqual(otherElection.publicSignals[0], valid.publicSignals[0]);
  await rejected(otherElection, /Election hash mismatch/);
  console.log("PASS [2]: changed election hash yields another nullifier, contract rejects it");
  const aliasInput = ballot();
  aliasInput.sk = String(BigInt(registered.sk) + bj.subOrder);
  assert.deepEqual(
    coords(bj.mulPointEscalar(bj.Base8, BigInt(aliasInput.sk))),
    coords(bj.mulPointEscalar(bj.Base8, BigInt(registered.sk))),
  );
  await assert.rejects(
    groth16.fullProve(aliasInput, wasm, zkey),
    /Assert Failed|Error in template/,
  );
  console.log(
    "PASS: circuit rejects sk + subgroup order for the same voter public key",
  );

  await assert.rejects(
    groth16.fullProve(
      ballot(registered, electionHash, PK, [1n, 1n]),
      wasm,
      zkey,
    ),
    /Assert Failed|Error in template/,
  );
  await assert.rejects(
    groth16.fullProve(
      ballot(registered, electionHash, PK, [0n, 0n]),
      wasm,
      zkey,
    ),
    /Assert Failed|Error in template/,
  );
  console.log(
    "PASS [3]: circuit rejects [1,1] and [0,0] for exactly one selection",
  );


  const inv7 = (() => { for (let i = 1n; i <= 7n; i++) if ((i * bj.subOrder + 1n) % 7n === 0n) return (i * bj.subOrder + 1n) / 7n; })();
  const fakePK = bj.addPoint(PK, bj.mulPointEscalar(bj.Base8, 1000n * inv7 % bj.subOrder));
  const shiftedInput = ballot(registered, electionHash, fakePK);
  const shifted = await prove(shiftedInput);
  const C1 = [F.e(shiftedInput.C1x[0]), F.e(shiftedInput.C1y[0])];
  const C2 = [F.e(shiftedInput.C2x[0]), F.e(shiftedInput.C2y[0])];
  const mask = bj.mulPointEscalar(C1, secretKey);
  assert.deepEqual(coords(bj.addPoint(C2, [F.neg(mask[0]), mask[1]])), coords(bj.mulPointEscalar(bj.Base8, 1001n)));
  await rejected(shifted, /Encryption public key mismatch/);
  console.log("PASS [4]: shifted PK decrypts to 1001*G, but contract rejects unofficial PK");
  // Recompute the path root so this failure specifically exercises the bit constraint.
  const nonbinary = ballot();
  nonbinary.pathIndices[0] = "2";
  let cur = BigInt(nonbinary.hash_pk);
  for (let i = 0; i < depth; i++) {
    const sibling = BigInt(nonbinary.pathElements[i]),
      bit = BigInt(nonbinary.pathIndices[i]);
    const left = F.toObject(F.e(cur + bit * (sibling - cur)));
    const right = F.toObject(F.e(sibling + bit * (cur - sibling)));
    cur = H([left, right]);
  }
  nonbinary.root = String(cur);
  await assert.rejects(
    groth16.fullProve(nonbinary, wasm, zkey),
    /Assert Failed|Error in template/,
  );
  console.log(
    "PASS: circuit rejects a nonbinary Merkle index even with matching computed root",
  );


  const [pA, pB, pC, signals] = proofArgs(valid);
  assert.equal(await contract.verifyVoteProofCombined(pA, pB, pC, signals), true);
  await assert.rejects(contract.submitVoteWithProof(...emptyProof, signals, bytes32(signals[0]), bytes32(signals[1]), "ipfs://fixture"), /Invalid combined proof/);
  await assert.rejects(contract.submitVoteWithProof(pA, pB, pC, signals, bytes32(1), bytes32(signals[1]), "ipfs://fixture"), /nullifier mismatch/);
  await assert.rejects(contract.submitVoteWithProof(pA, pB, pC, signals, bytes32(signals[0]), bytes32(1), "ipfs://fixture"), /hashCipherAll mismatch/);
  const forged = structuredClone(fakeRoot);
  forged.publicSignals[2] = registered.root;
  await assert.rejects(send(forged), /Invalid combined proof/);
  assert.equal(await contract.isNullifierUsed(bytes32(signals[0])), false);
  const [, outsider] = await ethers.getSigners();
  await assert.rejects(send(valid, contract.connect(outsider)), /Not authorized/);
  const legacy = new ethers.Interface(["function submitVote(bytes32,bytes32,string)"]);
  await assert.rejects(outsider.sendTransaction({ to: contract.target, data: legacy.encodeFunctionData("submitVote", [bytes32(signals[0]), bytes32(signals[1]), "ipfs://fixture"]) }));
  console.log("PASS: invalid proof, modified public signals, payload mismatch and legacy/unauthorized calls rejected");

  let content = structuredClone(validInput);
  const submit = await createVoteSubmitter(contract, async () => content);
  const payload = { election_id: "ELC2026", nullifier: signals[0], hashCipherAll: signals[1], ipfs_cid: "ipfs://fixture" };
  content.C2x[0] = "1";
  await assert.rejects(submit(valid.proof, signals, payload), /CID ciphertext does not match proof/);
  assert.equal(await contract.isNullifierUsed(bytes32(signals[0])), false);
  content = validInput;
  const receipt = await submit(valid.proof, signals, payload);
  assert.equal(receipt.code, 0);
  assert.equal(await contract.isNullifierUsed(bytes32(signals[0])), true);
  await assert.rejects(send(valid), /Double vote detected/);
  assert.equal((await submit(valid.proof, signals, payload)).code, 2);
  console.log(`PASS: CID check in client; valid proof accepted on-chain once (gas=${receipt.gasUsed})`);
  await (await contract.endElection()).wait();
  await assert.rejects(contract.setMerkleRoot(bytes32(2)), /Election configuration locked/);
  await assert.rejects(send(valid), /Election not active/);

  // Exercise the scenario generator without modifying the user's working files.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mode-b-prepare-"));
  try {
    for (const file of [
      "scripts/prepare.js",
      "circuits/VoteProofCombined.circom",
      "circuits/TallyValidity.circom",
      "scripts/gen_voter.js",
      "scripts/prepare_voters.js",
      "test/register.js",
      "test/vote.js",
    ]) {
      const dest = path.join(fixture, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(rootDir, file), dest);
    }
    execFileSync(process.execPath, [
      path.join(fixture, "scripts/prepare.js"),
      "16",
      "4",
      "2",
    ]);
    assert.match(
      read(path.join(fixture, "circuits/VoteProofCombined.circom")),
      /public \[root, election_hash, PKx, PKy\].*= VotingCircuit\(4, 4, 2\)/,
    );
    console.log(
      "PASS: prepare.js preserves public inputs and selection rule for another scenario",
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  console.log("Mode B R1 regression tests: PASS");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
