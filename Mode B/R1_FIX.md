# Mode B: R1 repair

Mode B enforces vote proof validity and election parameters on-chain.
`submitVoteWithProof` is the only vote-writing entry point. Its existing
`onlyAdmin` restriction is retained; the admin cannot bypass proof verification
or the locked root, election hash and encryption key through this entry point.

## Circuit and public signals

The current circuit instance is `VotingCircuit(10, 2, 1)`:
Merkle depth 10, two candidates, exactly one selection.

| Index | Public signal |
| --- | --- |
| 0 | nullifier (output) |
| 1 | hashCipherAll (output) |
| 2 | root |
| 3 | election_hash |
| 4 | PKx |
| 5 | PKy |

The circuit constrains each Merkle index to a bit, each candidate message to a
bit, their sum to `nSelections`, and sk to a canonical scalar below the BabyJubJub
subgroup order. This prevents another scalar representation of the same voter
public key from producing another nullifier. `prepare.js` preserves the public
input list and configures depth, candidate count and selection count together.

## Contract and application

Registration configures election information, candidates, root, trustees and
the encryption key, then calls `startElection`. Election information, root,
candidate list, election hash and encryption key are locked after activation
and remain locked after the election ends. `epk` encodes the same coordinates
as `epkX` and `epkY` using ABI encoding of two uint256 values.

`submitVoteWithProof` checks the six public signals, compares root/hash/key to
the official configuration, verifies the Groth16 proof, and only then consumes
the nullifier and emits `VotePublished`. The view function
`verifyVoteProofCombined` also checks the configured election parameters; the
standalone verifier only checks the cryptographic statement for its inputs.

`utils/ballot.js` supplies proof calldata conversion, the election hash and
ciphertext hashing, and the submission function used by `test/vote.js`.
The client fetches the CID and checks its ciphertext against the proven hash
before submitting. This client check is not the proof verification boundary:
the contract rejects invalid proofs and unofficial parameters even if the
client is bypassed.

The contract cannot fetch IPFS content. It binds the accepted ciphertext hash
to the proof but does not prove that an arbitrary CID string contains that
ciphertext. Readers must recompute the content hash against the accepted
on-chain hash; the existing aggregation script checks ciphertext hashes
against `VotePublished` hashes. An unavailable or mismatched CID must not be
treated as evidence of a valid ciphertext. No unconnected `cid_hash` input is
added to the circuit.

## Rebuild and regression tests

From `Mode B`:

```bash
node scripts/circom.js VoteProofCombined
npm run test:r1
```

The build regenerates the R1CS, WASM, zkey, vkey and the six-signal
`VoteProofCombinedVerifier.sol` together. Deploy new verifier and voting
contracts and register again before running the application. `run_all.js`
already builds the circuit, deploys these contracts, registers, then runs votes.
Old deployed contracts and old proofs are not upgraded by editing source.

The tests use an ephemeral Hardhat chain and synthetic voters and keys. They
exercise real proof generation, the deployed standalone verifier, and the
deployed voting contract. No running Hardhat node or IPFS daemon is needed.
CID transport is simulated by an in-memory fixture. Scenario generation is
tested in a temporary directory without changing the current scenario.

Expected results:

- Self-made root: raw proof verifies, voting contract reverts with root mismatch.
- Other election hash: another nullifier is produced, contract rejects the hash.
- `[1,1]` / `[0,0]`: witness generation fails under the one-selection rule.
- Shifted PK: raw proof verifies and the fixture decrypts to `1001*G`, but the
  contract rejects the unofficial key.
- Nonbinary path index and sk plus subgroup order: witness generation fails.
- Editing public signals without regenerating the proof: contract rejects it.
- Invalid proof, mismatched output arguments, unauthorized caller and legacy
  proofless entry point: rejected without consuming the nullifier.
- Valid proof: accepted once; replay and submission after election end rejected.
- Election configuration: required before activation, locked afterward.

Witness failure tests print expected assertion/template errors. Successful
completion ends with `Mode B R1 regression tests: PASS`. These checks do not
replace running all measurement scenarios or testing live IPFS transport.
