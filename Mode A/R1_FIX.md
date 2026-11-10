# Mode A: R1 repair and regression checks

Mode A keeps proof verification in the CA. The contract accepts ballots only
from the admin/CA, so this repair assumes the CA runs the updated acceptance
code with its trusted local verification key. It does not provide on-chain
proof verification or protection against a malicious CA.

## Circuit

`VoteProofCombined` now exposes these signals, in this order:

| Index | Signal |
| --- | --- |
| 0 | nullifier (output) |
| 1 | hashCipherAll (output) |
| 2 | root |
| 3 | election_hash |
| 4 | PKx |
| 5 | PKy |

The circuit enforces a canonical secret scalar (`0 <= sk < subgroup order`),
binary Merkle indices and exactly `nSelections` selected
candidates. Each message is still constrained to a bit by
`CiphertextValidity.circom`. The current instance uses depth 19, two candidates
and exactly one selection. `prepare.js` preserves these constraints when
generating other instances.

## Election and CA

Registration now follows:

1. Set election information (status remains Inactive).
2. Configure candidates, Merkle root, roles and trustees.
3. Store the Poseidon election ID hash and encryption key coordinates with
   `setElectionCryptoParams`. `epk` is the ABI encoding of these same coordinates.
4. Call `startElection`, which locks election information, candidates, root and
   encryption key permanently for this deployment.

`utils/voteAcceptance.js`, used by `test/vote.js`, checks all six public signals,
the payload nullifier, election ID/hash, the encryption key's subgroup, the
proof, and the actual ciphertext fetched from the CID. It recomputes the
ciphertext Poseidon hash using the same accumulation as the circuit.
This binds CID content to the proof without adding an unconnected `cid_hash`
input. Duplicate nullifiers are checked against the contract.

## Rebuild and test

From `Mode A`:

```bash
node scripts/circom.js VoteProofCombined
npm run test:r1
```

The build uses the existing local ptau and regenerates R1CS, WASM, zkey, vkey
and the matching Solidity verifier. Mode A does not call the vote verifier on
chain. Do not mix artifacts from before and after this repair.

The regression script uses an ephemeral Hardhat chain and synthetic voters and
keys; it does not need a running node or IPFS daemon and does not overwrite
election data or deployment addresses. CID content is supplied by an in-memory
fixture; live IPFS transport is not covered by this test. It also exercises
`prepare.js` in a temporary directory, leaving the current scenario unchanged.

Expected results:

- Self-made root: a proof may verify, but the CA rejects the unofficial root.
- Changed election hash: a proof may verify and yield another nullifier, but
  the CA rejects the unofficial election hash.
- Adding the subgroup order to sk: rejected by the circuit, preventing a second
  nullifier for another scalar representation of the same voter public key.
- `[1,1]` and `[0,0]`: witness generation fails for the one-selection rule.
- Shifted PK: a proof may verify and the fixture decrypts to `1001*G`, but the
  CA rejects the unofficial key.
- Nonbinary Merkle index: witness generation fails even if the supplied root
  is recomputed to match the mux arithmetic.
- Payload/CID mismatch: rejected before any nullifier is consumed.
- Valid ballot: accepted once; duplicate and unauthorized submission rejected.
- Election configuration: cannot be changed after activation or after ending.

The expected witness failures print `ERROR ... Assert Failed` / template errors;
the overall result must end with `Mode A R1 regression tests: PASS`.

For the full application flow, deploy a new Mode A contract and register again
using the updated scripts before running votes. Existing deployed bytecode
does not change when source files are edited. The prior PoC only tests raw
proof validity and is not a test of the updated CA acceptance boundary.
