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
  hashElectionId,
  toSolidityProof,
} = require("../utils/ballot");
const { createTrusteeApprover } = require("../utils/voteApproval");
const { collectApprovals } = require("../test/vote_modules/collector");
const { createVoteSubmitter } = require("../test/vote_modules/submit");

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
          bj.mulPointEscalar(bj.Base8, (m[i] + bj.subOrder) % bj.subOrder),
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

  const [admin, t1, t2, t3, outsider] = await ethers.getSigners();
  const trustees = [t1, t2, t3];
  const partial = await (await ethers.getContractFactory("PartialDecryptionVerifier")).deploy();
  const combined = await (await ethers.getContractFactory("VoteProofCombinedVerifier")).deploy();
  await partial.waitForDeployment();
  await combined.waitForDeployment();
  const factory = await ethers.getContractFactory("E_Voting");
  const contract = await factory.deploy(partial.target, combined.target);
  await contract.waitForDeployment();
  await assert.rejects(contract.startElection(), /Election not configured/);
  await (await contract.setElectionInfo("ELC2026", "R1 test", 0, 9999999999)).wait();
  await assert.rejects(contract.setElectionInfo("ELC2026", "reset", 0, 99), /already configured/);
  await assert.rejects(contract.submitVoteWithTrusteeSignatures(bytes32(1), bytes32(2), "ipfs://fixture", []), /Election not active/);
  await (await contract.setMerkleRoot(bytes32(registered.root))).wait();
  await (await contract.addCandidate("A")).wait();
  await (await contract.addCandidate("B")).wait();
  await assert.rejects(contract.startElection(), /Election not configured/);
  await assert.rejects(contract.setElectionCryptoParams(electionHash, 0, 1), /Identity public key/);
  await (await contract.setElectionCryptoParams(electionHash, x, y)).wait();
  assert.equal(await contract.epk(), ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [x, y]));
  await assert.rejects(contract.startElection(), /Trustees not initialized/);
  await assert.rejects(contract.registerTrustees([t1.address, t1.address], 2), /Duplicate trustee/);
  await assert.rejects(contract.registerTrustees([t1.address], 0), /Invalid threshold/);
  await (await contract.registerTrustees(trustees.map(t => t.address), 2)).wait();
  await (await contract.startElection()).wait();
  const changes = [
    () => contract.setElectionInfo("other", "other", 0, 99),
    () => contract.setMerkleRoot(bytes32(2)),
    () => contract.addCandidate("C"),
    () => contract.setElectionCryptoParams(42, x, y),
    () => contract.publishEpk(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [x, y])),
    () => contract.registerTrustees([outsider.address], 1),
  ];
  for (const change of changes) await assert.rejects(change(), /Election configuration locked/);
  console.log("PASS: setup and trustees required; configuration locked after activation");

  let content;
  let signCalls = 0;
  const approvers = await Promise.all(trustees.map(t => createTrusteeApprover(contract, {
    getAddress: () => t.getAddress(),
    signMessage: async (message) => { signCalls++; return t.signMessage(message); },
  }, vkey, async (cid) => {
    assert.equal(cid, "ipfs://fixture");
    if (content instanceof Error) throw content;
    return content;
  })));
  await assert.rejects(createTrusteeApprover(contract, t1, { nPublic: 2 }, async () => content), /expected 6 public signals/);
  function packet(result) {
    return { ...result, votePayload: {
      nullifier: bytes32(result.publicSignals[0]),
      hashCipherAll: bytes32(result.publicSignals[1]), cid: "ipfs://fixture",
    } };
  }
  function proofArgs(result) {
    const { pA, pB, pC } = toSolidityProof(result.proof);
    return [pA, pB, pC, result.publicSignals];
  }
  function send(p, signatures, target = contract) {
    return target.submitVoteWithTrusteeSignatures(
      p.votePayload.nullifier, p.votePayload.hashCipherAll, p.votePayload.cid, signatures,
    );
  }
  async function rejected(result) {
    assert.equal(await combined.verifyProof(...proofArgs(result)), true);
    assert.equal(await contract.verifyVoteProofCombined(...proofArgs(result)), false);
    for (const approve of approvers) {
      await assert.rejects(approve(packet(result)), /Election public inputs mismatch/);
    }
    assert.equal(await contract.isNullifierUsed(bytes32(result.publicSignals[0])), false);
  }
  const validInput = ballot();
  content = validInput;
  const valid = await prove(validInput);
  const p = packet(valid);
  assert.deepEqual(valid.publicSignals.slice(2), [registered.root, electionHash, x, y]);
  assert.equal(await contract.verifyVoteProofCombined(...proofArgs(valid)), true);
  const fakeRoot = await prove(ballot(voter(54321n)));
  await rejected(fakeRoot);
  console.log("PASS [1]: raw proof for self-made root verifies; trustees refuse to sign");
  const otherElection = await prove(ballot(registered, BigInt(electionHash) + 1n));
  assert.notEqual(otherElection.publicSignals[0], valid.publicSignals[0]);
  await rejected(otherElection);
  console.log("PASS [2]: changed election hash creates another nullifier; trustees reject");
  const aliasInput = ballot();
  aliasInput.sk = String(BigInt(registered.sk) + bj.subOrder);
  assert.deepEqual(coords(bj.mulPointEscalar(bj.Base8, BigInt(aliasInput.sk))), coords(bj.mulPointEscalar(bj.Base8, BigInt(registered.sk))));
  await assert.rejects(groth16.fullProve(aliasInput, wasm, zkey), /Assert Failed|Error in template/);
  for (const messages of [[1n, 1n], [0n, 0n], [2n, -1n]]) {
    await assert.rejects(groth16.fullProve(ballot(registered, electionHash, PK, messages), wasm, zkey), /Assert Failed|Error in template/);
  }
  console.log("PASS [3]: circuit rejects scalar alias, invalid bits and invalid selection count");
  const inv7 = (() => { for (let i = 1n; i <= 7n; i++) if ((i * bj.subOrder + 1n) % 7n === 0n) return (i * bj.subOrder + 1n) / 7n; })();
  const fakePK = bj.addPoint(PK, bj.mulPointEscalar(bj.Base8, 1000n * inv7 % bj.subOrder));
  const shiftedInput = ballot(registered, electionHash, fakePK);
  const shifted = await prove(shiftedInput);
  const C1 = [F.e(shiftedInput.C1x[0]), F.e(shiftedInput.C1y[0])];
  const C2 = [F.e(shiftedInput.C2x[0]), F.e(shiftedInput.C2y[0])];
  const mask = bj.mulPointEscalar(C1, secretKey);
  assert.deepEqual(coords(bj.addPoint(C2, [F.neg(mask[0]), mask[1]])), coords(bj.mulPointEscalar(bj.Base8, 1001n)));
  await rejected(shifted);
  console.log("PASS [4]: shifted PK decrypts to 1001*G; trustees reject unofficial key");
  const nonbinary = ballot();
  nonbinary.pathIndices[0] = "2";
  let cur = BigInt(nonbinary.hash_pk);
  for (let i = 0; i < depth; i++) {
    const sibling = BigInt(nonbinary.pathElements[i]), bit = BigInt(nonbinary.pathIndices[i]);
    const left = F.toObject(F.e(cur + bit * (sibling - cur)));
    const right = F.toObject(F.e(sibling + bit * (cur - sibling)));
    cur = H([left, right]);
  }
  nonbinary.root = String(cur);
  await assert.rejects(groth16.fullProve(nonbinary, wasm, zkey), /Assert Failed|Error in template/);

  const forged = structuredClone(fakeRoot);
  forged.publicSignals[2] = registered.root;
  await assert.rejects(approvers[0](packet(forged)), /Invalid Groth16 proof/);
  const invalid = structuredClone(p);
  invalid.proof.pi_a = ["0", "0", "1"];
  await assert.rejects(approvers[0](invalid), /Invalid Groth16 proof/);
  for (const name of ["nullifier", "hashCipherAll"]) {
    const mismatched = structuredClone(p);
    mismatched.votePayload[name] = bytes32(1);
    await assert.rejects(approvers[0](mismatched), /outputs do not match/);
  }
  const noncanonical = structuredClone(p);
  noncanonical.publicSignals[0] = String(BigInt(valid.publicSignals[0]) + 21888242871839275222246405745257275088548364400416034343698204186575808495617n);
  await assert.rejects(approvers[0](noncanonical), /Noncanonical field value/);
  content = structuredClone(validInput);
  content.C2x[0] = "1";
  await assert.rejects(approvers[0](p), /CID ciphertext does not match proof/);
  content = { ...validInput, C1x: [] };
  await assert.rejects(approvers[0](p), /Invalid ciphertext dimensions/);
  content = new Error("CID unavailable");
  await assert.rejects(approvers[0](p), /CID unavailable/);
  content = validInput;
  assert.equal(signCalls, 0, "Rejected ballots must never reach signing");
  console.log("PASS: modified signals, invalid proof, payload/CID mismatch and unavailable CID rejected before signing");

  // One malicious trustee cannot obtain a threshold for an unofficial root.
  const config = { deadlineMs: 10000, seed: 2026,
    defaultTrustee: { behavior: "NORMAL", delayMs: 0, jitterMs: 0 }, trustees: {} };
  const malicious = packet(fakeRoot);
  const digest = await contract.getVoteApprovalDigest(malicious.votePayload.nullifier, malicious.votePayload.hashCipherAll, malicious.votePayload.cid);
  const maliciousSignature = await t1.signMessage(ethers.getBytes(digest));
  const pool = approvers.map((approve, i) => ({ id: i + 1, request: async ({ packet: requestPacket }) => {
    if (i === 0) return { status: "APPROVED", signature: maliciousSignature };
    try { return { status: "APPROVED", signature: await approve(requestPacket) }; }
    catch (error) { return { status: "REJECTED", error: error.message }; }
  } }));
  const refused = await collectApprovals({ pool, packet: malicious, threshold: 2, config, voteIndex: 0 });
  await refused.drained;
  assert.equal(refused.status, "INSUFFICIENT_APPROVALS");
  await assert.rejects(send(malicious, [maliciousSignature]), /Not enough signatures/);
  assert.equal(signCalls, 0);

  const timings = {};
  const signatures = [await approvers[0](p, timings), await approvers[1](p)];
  assert(timings.verifyTimeMs >= 0 && timings.digestTimeMs >= 0 && timings.signTimeMs >= 0);
  const expectedDigest = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "bytes32", "uint256", "uint256", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "address"],
    ["ELC2026", bytes32(registered.root), electionHash, x, y, p.votePayload.nullifier, p.votePayload.hashCipherAll,
      ethers.keccak256(ethers.toUtf8Bytes(p.votePayload.cid)), (await ethers.provider.getNetwork()).chainId, contract.target],
  ));
  assert.equal(await contract.getVoteApprovalDigest(p.votePayload.nullifier, p.votePayload.hashCipherAll, p.votePayload.cid), expectedDigest);
  await assert.rejects(send(p, []), /Not enough signatures/);
  await assert.rejects(send(p, signatures.slice(0, 1)), /Not enough signatures/);
  await assert.rejects(send(p, [signatures[0], signatures[0]]), /Duplicate trustee signatures/);
  const outsiderSig = await outsider.signMessage(ethers.getBytes(expectedDigest));
  await assert.rejects(send(p, [signatures[0], outsiderSig]), /Signer not trustee/);
  await assert.rejects(send(p, signatures, contract.connect(outsider)), /Not authorized/);
  for (const field of ["nullifier", "hashCipherAll", "cid"]) {
    const tampered = structuredClone(p);
    tampered.votePayload[field] = field === "cid" ? "ipfs://other" : bytes32(42);
    await assert.rejects(send(tampered, signatures));
    assert.equal(await contract.isNullifierUsed(tampered.votePayload.nullifier), false);
  }
  const second = await factory.deploy(partial.target, combined.target);
  await second.waitForDeployment();
  await (await second.setElectionInfo("ELC2026", "Other deployment", 0, 9999999999)).wait();
  await (await second.setMerkleRoot(bytes32(registered.root))).wait();
  await (await second.addCandidate("A")).wait();
  await (await second.addCandidate("B")).wait();
  await (await second.setElectionCryptoParams(electionHash, x, y)).wait();
  await (await second.registerTrustees(trustees.map(t => t.address), 2)).wait();
  await (await second.startElection()).wait();
  await assert.rejects(send(p, signatures, second), /Signer not trustee/);
  for (const fragment of ["submitVote(bytes32,bytes32,string)", "submitVoteWithProof(uint256[2],uint256[2][2],uint256[2],uint256[6],bytes32,bytes32,string)"]) {
    const legacy = new ethers.Interface([`function ${fragment}`]);
    const args = fragment.startsWith("submitVote(") ? [p.votePayload.nullifier, p.votePayload.hashCipherAll, p.votePayload.cid] : [...proofArgs(valid), p.votePayload.nullifier, p.votePayload.hashCipherAll, p.votePayload.cid];
    await assert.rejects(admin.sendTransaction({ to: contract.target, data: legacy.encodeFunctionData(fragment, args) }));
  }
  assert.equal(await contract.isNullifierUsed(p.votePayload.nullifier), false);
  const submit = createVoteSubmitter(contract);
  const receipt = await submit(p, signatures);
  assert.equal(receipt.code, 0);
  const events = await contract.queryFilter(contract.filters.VotePublished());
  assert.equal(events.length, 1);
  assert.equal(events[0].args.nullifier, p.votePayload.nullifier);
  assert.equal(events[0].args.hashCipher, p.votePayload.hashCipherAll);
  assert.equal(events[0].args.cid, p.votePayload.cid);
  await assert.rejects(send(p, signatures), /Double vote detected/);
  await assert.rejects(approvers[2](p), /Double vote detected/);
  assert.equal((await submit(p, signatures)).code, 2);
  console.log(`PASS: threshold enforced; tampering, unauthorized/legacy calls and cross-contract replay rejected; valid ballot accepted once (gas=${receipt.gasUsed})`);
  await (await contract.endElection()).wait();
  for (const change of changes) await assert.rejects(change(), /Election configuration locked/);
  await assert.rejects(send(p, signatures), /Election not active/);
  await assert.rejects(approvers[0](p), /Election inactive/);

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mode-c-prepare-"));
  try {
    for (const file of ["scripts/prepare.js", "circuits/VoteProofCombined.circom", "circuits/TallyValidity.circom", "scripts/gen_voter.js", "scripts/prepare_voters.js", "test/register.js", "test/vote.js", "test/partial.js", "test/tally.js", "test/aggregate.js"]) {
      const dest = path.join(fixture, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(rootDir, file), dest);
    }
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, [path.join(fixture, "scripts/prepare.js"), "16", "4", "2", "5", "3"]);
    assert.match(read(path.join(fixture, "circuits/VoteProofCombined.circom")), /public \[root, election_hash, PKx, PKy\].*= VotingCircuit\(4, 4, 2\)/);
    assert.match(read(path.join(fixture, "test/register.js")), /const TOTAL_TRUSTEES = 5;/);
    assert.match(read(path.join(fixture, "test/vote.js")), /const THRESHOLD = 3;/);
    console.log("PASS: prepare.js preserves public inputs, selection count and configurable trustee threshold across repeated runs");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  console.log("Mode C R1 regression tests: PASS");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
