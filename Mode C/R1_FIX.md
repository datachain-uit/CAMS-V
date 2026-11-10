# Mode C: R1 repair

Mode C keeps Groth16 verification in the independent trustee workers. The CA
collects approvals and submits a ballot with at least `thresholdRequired`
distinct registered trustee signatures. The contract checks signatures and
nullifier reuse; it does not verify the vote proof on this submission path.
Security therefore assumes fewer than the approval threshold of trustees
collude, and honest trustees use the updated code and trusted local vkey.
A colluding threshold can still sign an invalid ballot.

## Circuit and public signals

The current instance is `VotingCircuit(10, 2, 1)`: depth 10, two candidates,
exactly one selection. It uses the same repaired constraints as Modes A/B:
canonical `0 <= sk < BabyJubJub subgroup order`, binary Merkle indices,
binary candidate messages, and a message sum equal to `nSelections`.

| Index | Public signal |
| --- | --- |
| 0 | nullifier (output) |
| 1 | hashCipherAll (output) |
| 2 | root |
| 3 | election_hash |
| 4 | PKx |
| 5 | PKy |

`prepare.js` preserves all four public inputs and sets depth, candidate count
and selection count together. It also retains Mode C's configurable trustee
count and threshold.

## Election setup and approval

`setElectionInfo` leaves the election Inactive. Registration configures the
candidates, root, aggregator and trustees, then publishes the Poseidon election
ID hash and encryption key through `setElectionCryptoParams`, and finally
calls `startElection`. The election ID, candidate list, root, election hash,
key, trustee list and threshold cannot change after activation or after ending.
`epk` is the ABI encoding of the same two uint256 coordinates as `epkX/epkY`.

`test/trustee_worker.js` uses `utils/voteApproval.js` before signing:

1. Require six canonical public signals and matching payload outputs.
2. Read the official active election configuration from the contract; check
   trustee registration and that the nullifier is unused.
3. Check root, election hash and PK coordinates against that configuration,
   recompute the election ID hash, and validate PK subgroup membership.
4. Verify the proof with the worker's trusted local vkey.
5. Fetch the actual CID content and recompute its ciphertext Poseidon hash
   with the circuit's accumulation and configured candidate count. Reject
   unavailable, malformed, oversized or mismatched content before signing.
6. Obtain the contract digest and sign it with the trustee's own signer.

The signed digest covers election ID, root, election hash, PK coordinates,
nullifier, ciphertext hash, hash of the CID string, chain ID and contract
address. The contract accepts only the admin's submission with the configured
threshold of distinct registered signers. The proofless `submitVote` and
alternate `submitVoteWithProof` entry points remain absent.
`verifyVoteProofCombined` is a view helper with six signals and official
parameter checks; it is not used to write votes.

The contract cannot fetch IPFS content. The CID-to-ciphertext check is performed
by honest trustees before signing, and readers should still check retrieved
content against the accepted `VotePublished` ciphertext hash. No unrelated
`cid_hash` signal is added to the circuit.

Worker `verifyTimeMs` now includes all validation before approval, including
configuration reads and CID fetch/hash checks. `digestTimeMs` and `signTimeMs`
remain separate. Earlier verification-time measurements are not directly
comparable. Collector threshold, deadline, refusal/offline simulation and drain
behavior are retained.

## Rebuild and regression tests

From `Mode C`:

```bash
node scripts/circom.js VoteProofCombined
npm run test:r1
node test/collector.smoke.test.js
```

The build regenerates R1CS, WASM, zkey, vkey and the matching six-signal Solidity
verifier together. Tests use real proofs, an ephemeral Hardhat chain, the same
approval helper as the workers, multiple trustee signers and an in-memory CID
fixture. They do not require a running node/IPFS daemon or overwrite election
data/deployment addresses. `prepare.js` runs twice in a temporary directory.
Live IPFS transport and worker IPC are not covered by these regression tests.

Expected checks include:

- Self-made root and other election hash: raw proof verifies; trustees refuse
  approval. A changed election hash produces another nullifier but no approval.
- Shifted PK: raw proof verifies and decrypts to `1001*G` in the fixture;
  trustees reject the unofficial key.
- Scalar alias, nonbinary path indices/messages, `[1,1]` and `[0,0]`: witness
  generation fails under the configured rules.
- Modified public signals, invalid proof, payload mismatch, unavailable CID,
  malformed ciphertext and ciphertext mismatch: no signing call occurs.
- One malicious signer below a 2-of-3 threshold cannot get an invalid ballot
  through the collector or voting contract.
- Missing/duplicate/unregistered signatures, unauthorized and legacy calls,
  changed payload/CID and cross-contract replay: rejected without consuming
  the nullifier.
- Valid ballot: accepted once with the original output hash and CID; replay
  and approval/submission after ending are rejected. Configuration stays locked.

Expected witness failures print assertion/template errors; the final result
must end with `Mode C R1 regression tests: PASS`.

Deploy new verifier and voting contracts and register again before running the
application; old deployed bytecode, proofs and approval signatures are not
upgraded by editing sources. `scripts/run_all.js` already rebuilds circuits,
deploys, updates `configs/blockchain.js`, registers, then runs the application.
