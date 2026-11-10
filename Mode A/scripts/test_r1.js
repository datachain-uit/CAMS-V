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
} = require("../utils/voteAcceptance");

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
  const contract = await (await ethers.getContractFactory("E_Voting")).deploy();
  await contract.waitForDeployment();
  await assert.rejects(contract.startElection(), /Election not configured/);
  await (
    await contract.setElectionInfo("ELC2026", "R1 test", 0, 9999999999)
  ).wait();
  await assert.rejects(
    contract.submitVote(bytes32(1), bytes32(2), "ipfs://test"),
    /Election not active/,
  );
  await (await contract.setMerkleRoot(bytes32(registered.root))).wait();
  await (await contract.addCandidate("A")).wait();
  await (await contract.addCandidate("B")).wait();
  await assert.rejects(contract.startElection(), /Election not configured/);
  await (await contract.setElectionCryptoParams(electionHash, x, y)).wait();
  assert.equal(
    await contract.epk(),
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [x, y]),
  );
  await (await contract.startElection()).wait();
  for (const change of [
    () => contract.setElectionInfo("other", "other", 0, 99),
    () => contract.setMerkleRoot(bytes32(2)),
    () => contract.addCandidate("C"),
    () => contract.setElectionCryptoParams(42, x, y),
    () =>
      contract.publishEpk(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint256"],
          [x, y],
        ),
      ),
  ])
    await assert.rejects(change(), /Election configuration locked/);
  console.log(
    "PASS: setup required; root, election ID/hash, public key and candidates locked",
  );

  let content;
  const submit = await createVoteSubmitter(contract, vkey, async () => content);
  async function tryAccept(input, result, extra = {}) {
    content = input;
    return submit(result.proof, result.publicSignals, {
      election_id: "ELC2026",
      nullifier: result.publicSignals[0],
      ipfs_cid: "ipfs://fixture",
      ...extra,
    });
  }
  const validInput = ballot();
  const valid = await prove(validInput);
  assert.deepEqual(valid.publicSignals.slice(2), [
    registered.root,
    electionHash,
    x,
    y,
  ]);
  const fakeRootInput = ballot(voter(54321n));
  const fakeRoot = await prove(fakeRootInput);
  assert.equal((await tryAccept(fakeRootInput, fakeRoot)).code, 1);
  assert.equal(
    await contract.isNullifierUsed(bytes32(fakeRoot.publicSignals[0])),
    false,
  );
  console.log(
    "PASS [1]: proof for self-made root verifies, CA rejects unofficial root",
  );

  const otherElectionInput = ballot(registered, BigInt(electionHash) + 1n);
  const otherElection = await prove(otherElectionInput);
  assert.notEqual(otherElection.publicSignals[0], valid.publicSignals[0]);
  assert.equal((await tryAccept(otherElectionInput, otherElection)).code, 1);
  console.log(
    "PASS [2]: changed election hash yields another nullifier, CA rejects it",
  );

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

  // Inverse of 7 modulo subgroup order, calculated without exposing any repo shares.
  const inv7 = (() => {
    for (let i = 1n; i <= 7n; i++)
      if ((i * bj.subOrder + 1n) % 7n === 0n)
        return (i * bj.subOrder + 1n) / 7n;
  })();
  const fakePK = bj.addPoint(
    PK,
    bj.mulPointEscalar(bj.Base8, (1000n * inv7) % bj.subOrder),
  );
  const shiftedInput = ballot(registered, electionHash, fakePK);
  const shifted = await prove(shiftedInput);
  const C1 = [F.e(shiftedInput.C1x[0]), F.e(shiftedInput.C1y[0])];
  const C2 = [F.e(shiftedInput.C2x[0]), F.e(shiftedInput.C2y[0])];
  const mask = bj.mulPointEscalar(C1, secretKey);
  assert.deepEqual(
    coords(bj.addPoint(C2, [F.neg(mask[0]), mask[1]])),
    coords(bj.mulPointEscalar(bj.Base8, 1001n)),
  );
  assert.equal((await tryAccept(shiftedInput, shifted)).code, 1);
  console.log(
    "PASS [4]: shifted PK decrypts to 1001*G, but CA rejects unofficial PK",
  );

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

  assert.equal(
    (await tryAccept(validInput, valid, { nullifier: "1" })).code,
    1,
  );
  content = structuredClone(validInput);
  content.C2x[0] = "1";
  assert.equal(
    (
      await submit(valid.proof, valid.publicSignals, {
        election_id: "ELC2026",
        nullifier: valid.publicSignals[0],
        ipfs_cid: "ipfs://tampered",
      })
    ).code,
    1,
  );
  assert.equal(
    await contract.isNullifierUsed(bytes32(valid.publicSignals[0])),
    false,
  );
  const [, outsider] = await ethers.getSigners();
  await assert.rejects(
    contract
      .connect(outsider)
      .submitVote(
        bytes32(valid.publicSignals[0]),
        bytes32(valid.publicSignals[1]),
        "ipfs://fixture",
      ),
    /Not authorized/,
  );
  assert.equal((await tryAccept(validInput, valid)).code, 0);
  assert.equal((await tryAccept(validInput, valid)).code, 2);
  console.log(
    "PASS: payload/CID mismatch rejected; valid vote accepted once; outsider rejected",
  );
  await (await contract.endElection()).wait();
  await assert.rejects(
    contract.setMerkleRoot(bytes32(2)),
    /Election configuration locked/,
  );
  assert.equal((await tryAccept(validInput, valid)).code, 1);

  // Exercise the scenario generator without modifying the user's working files.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mode-a-prepare-"));
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
  console.log("Mode A R1 regression tests: PASS");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
