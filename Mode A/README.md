# E-HOVA: Efficient Hybrid Off-chain Verification and Aggregation

E-HOVA is a blockchain-based e-voting prototype that combines zero-knowledge proofs, homomorphic encryption, and threshold decryption to reduce on-chain cost while preserving public verifiability.

The system adopts a hybrid architecture:

- ballot validity is verified off-chain
- only minimal commitments are stored on-chain
- ciphertexts are aggregated off-chain
- the final tally is recovered through threshold decryption

---

# Features

- Blockchain-based e-voting prototype built on Ethereum local network with Hardhat
- Voter registration using Merkle tree commitments
- Zero-knowledge proof verification for ballot validity
- Off-chain ciphertext storage through IPFS with on-chain integrity anchoring
- Off-chain aggregation of encrypted ballots
- Threshold-based tally validation and decryption workflow
- Smart contracts for voting, partial decryption verification, and tally verification
- Test scripts for registration, voting, aggregation, partial decryption, and tallying

---

# Project Structure

```text
zkp-EHOVA/
├── artifacts/                  # Hardhat build artifacts
├── cache/                      # Hardhat cache files
├── circuits/                   # Circom circuits, inputs, and build outputs
├── configs/                    # Blockchain configuration and contract access helpers
├── contracts/                  # Solidity smart contracts
├── data/                       # Generated data, keys, votes, and intermediate outputs
├── node_modules/               # Installed dependencies
├── scripts/                    # Setup and automation scripts
├── test/                       # Execution and evaluation scripts 
├── utils/                      # Helper utilities
├── hardhat.config.js           # Hardhat configuration
├── package.json                # Project metadata and npm scripts
├── package-lock.json
└── README.md
```

---

# Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/datachain-uit/zkp-EHOVA
cd zkp-EHOVA
npm install
```

---

# IPFS Setup

E-HOVA stores encrypted ballots **off-chain using IPFS**.  
You must start a local IPFS node before running the voting workflow.

## Install IPFS

Download and install **IPFS (Kubo)**:

```bash
wget https://dist.ipfs.tech/kubo/v0.29.0/kubo_v0.29.0_linux-amd64.tar.gz
```

Extract the package:

```bash
tar -xvzf kubo_v0.29.0_linux-amd64.tar.gz
```

Enter the extracted directory:

```bash
cd kubo
```

Install IPFS:

```bash
sudo bash install.sh
```

Verify installation:

```bash
ipfs --version
```

---

## Initialize IPFS Repository

Run this command once to initialize the IPFS repository:

```bash
ipfs init
```

---

## Start the IPFS Daemon

Start the local IPFS node:

```bash
ipfs daemon
```

Keep the daemon running while executing the voting workflow.

---

# How to Run

## 1. Start a Local Ethereum Node

Run the local Hardhat blockchain in a separate terminal and keep it running during the experiment:

```bash
npx hardhat node
```

---

## 2. Prepare the Dataset and Election Parameters

In another terminal, initialize the election data with the following format:

```bash
node scripts/prepare.js <num_voters> <num_candidates> <num_choice>
```

### Parameters

| Parameter | Description |
|---|---|
| num_voters | number of voters |
| num_candidates | number of candidates |
| num_choice | number of choices allowed in each ballot |

### Example

```bash
node scripts/prepare.js 100 3 1
```

This example prepares an election with:

- 100 voters  
- 3 candidates  
- 1 selectable choice per ballot  

---

## 3. Execute the Full Workflow

Run the complete experiment:

```bash
node scripts/run_all.js
```

This script executes the main phases of the E-HOVA workflow, including:

- voter registration
- vote submission
- ciphertext aggregation
- partial decryption
- final tally verification

---

# Retrieve Ballot Data from IPFS

After vote submission, encrypted ballots are uploaded to IPFS.

The **CID of each ballot** is stored in:

```
data/vote.json
```

Example:

```json
{
  "cid": "QmXDZmPr5Fsb37qMbN3Jd3PSEp19mFsrEyt6BcFX3ABuKB"
}
```

Copy the CID and retrieve the stored ballot content using the IPFS gateway:

```
http://localhost:8080/ipfs/<CID>
```

Example:

```
http://localhost:8080/ipfs/QmXDZmPr5Fsb37qMbN3Jd3PSEp19mFsrEyt6BcFX3ABuKB
```

Open the link in a browser to view the stored ballot data.

## Contributors

- **Leader**: M.Sc. IT. Khoa Tan VO
- **Members**: Phi-Thong Vo-Van, Quang-Vu Pham
