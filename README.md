# CAMS-V: Context-Aware Multi-Strategy Verification Framework for Blockchain-Based E-Voting

CAMS-V is a blockchain-based e-voting prototype that supports multiple ballot verification strategies within a unified election workflow.

The repository contains three verification modes:

* **Mode A**: off-chain authority verification
* **Mode B**: on-chain zk-SNARK-based proof verification
* **Mode C**: trustee-assisted threshold verification

Each mode follows the same general election pipeline, including voter registration, ballot submission, ciphertext storage, aggregation, partial decryption, and final tally verification. The main difference among the modes lies in how ballot validity is verified before the ballot commitment is accepted on-chain.

---

# Features

* Blockchain-based e-voting prototype built on an Ethereum local network with Hardhat
* Voter registration using Merkle tree commitments
* Zero-knowledge proof generation and verification for ballot validity
* Off-chain ciphertext storage through IPFS with on-chain integrity anchoring
* Off-chain aggregation of encrypted ballots
* Threshold-based partial decryption and tally verification workflow
* Three ballot verification modes for context-aware comparison
* Smart contracts for voting, proof verification, trustee approval, partial decryption, and tally verification
* Test scripts for registration, voting, aggregation, partial decryption, and tallying

---

# Verification Modes

## Mode A: Off-chain Authority Verification

Mode A follows an off-chain verification workflow. The Certificate Authority verifies ballot validity off-chain, uploads the ciphertext to IPFS, and submits only the accepted ballot commitment to the smart contract.

This mode reduces on-chain cost, but the ballot acceptance decision depends more heavily on the Certificate Authority.

## Mode B: On-chain zk-SNARK Proof Verification

Mode B moves ballot proof verification to the smart contract. The smart contract verifies the zk-SNARK proof before accepting the ballot commitment.

This mode provides stronger public verifiability, but it increases gas cost because proof verification is executed on-chain.

## Mode C: Trustee-assisted Threshold Verification

Mode C uses a group of trustees to verify ballots off-chain. A ballot is accepted only when the smart contract receives enough valid trustee approval signatures according to the configured threshold.

This mode reduces dependence on a single authority and provides better trust distribution, but it requires trustee coordination and threshold configuration.

---

# Project Structure

```text
CAMS-V/
├── Mode A/                     # Off-chain authority verification workflow
├── Mode B/                     # On-chain zk-SNARK proof verification workflow
├── Mode C/                     # Trustee-assisted threshold verification workflow
└── README.md                   # Project overview and execution guide
```

Each mode folder follows a similar internal structure:

```text
Mode X/
├── artifacts/                  # Hardhat build artifacts
├── cache/                      # Hardhat cache files
├── circuits/                   # Circom circuits, inputs, and build outputs
├── configs/                    # Blockchain configuration and contract access helpers
├── contracts/                  # Solidity smart contracts
├── data/                       # Generated data, keys, votes, and intermediate outputs
├── scripts/                    # Setup and automation scripts
├── test/                       # Execution and evaluation scripts
├── utils/                      # Helper utilities
├── hardhat.config.js           # Hardhat configuration
├── package.json                # Project metadata and npm scripts
├── package-lock.json
└── README.md                   # Optional mode-specific notes
```

---

# Installation

Clone the repository:

```bash
git clone https://github.com/datachain-uit/CAMS-V
cd CAMS-V
```

Each mode is an independent Hardhat project. Enter the mode that you want to run and install dependencies.

For Mode A:

```bash
cd "Mode A"
npm install
```

For Mode B:

```bash
cd "Mode B"
npm install
```

For Mode C:

```bash
cd "Mode C"
npm install
```

---

# IPFS Setup

CAMS-V stores encrypted ballots off-chain using IPFS. You must start a local IPFS node before running the voting workflow.

## Install IPFS

Download and install IPFS Kubo:

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

The following steps should be executed inside the folder of the selected mode.

For example:

```bash
cd CAMS-V
cd "Mode A"
```

or:

```bash
cd CAMS-V
cd "Mode B"
```

or:

```bash
cd CAMS-V
cd "Mode C"
```

---

## 1. Start a Local Ethereum Node

Run the local Hardhat blockchain in a separate terminal and keep it running during the experiment:

```bash
npx hardhat node
```

---

## 2. Prepare the Dataset and Election Parameters

Open another terminal and enter the same mode folder.

For Mode A and Mode B, initialize the election data with the following format:

```bash
node scripts/prepare.js <num_voters> <num_candidates> <num_choice>
```

### Parameters for Mode A and Mode B

| Parameter      | Description                              |
| -------------- | ---------------------------------------- |
| num_voters     | Number of voters                         |
| num_candidates | Number of candidates                     |
| num_choice     | Number of choices allowed in each ballot |

### Example for Mode A and Mode B

```bash
node scripts/prepare.js 100 3 1
```

This example prepares an election with:

* 100 voters
* 3 candidates
* 1 selectable choice per ballot

---

For Mode C, initialize the election data with the following format:

```bash
node scripts/prepare.js <num_voters> <num_candidates> <num_choice> <num_trustees> <threshold>
```

### Parameters for Mode C

| Parameter      | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| num_voters     | Number of voters                                                |
| num_candidates | Number of candidates                                            |
| num_choice     | Number of choices allowed in each ballot                        |
| num_trustees   | Number of trustees participating in threshold approval          |
| threshold      | Minimum number of trustee approvals required to accept a ballot |

### Example for Mode C

```bash
node scripts/prepare.js 100 3 1 3 2
```

This example prepares an election with:

* 100 voters
* 3 candidates
* 1 selectable choice per ballot
* 3 trustees
* threshold of 2 approvals

---

## 3. Execute the Full Workflow

Run the complete experiment inside the selected mode folder:

```bash
node scripts/run_all.js
```

This script executes the main phases of the CAMS-V workflow, including:

* voter registration
* vote submission
* ballot verification according to the selected mode
* ciphertext aggregation
* partial decryption
* final tally verification

---

# Running Each Mode

## Run Mode A

```bash
cd CAMS-V
cd "Mode A"
npm install
npx hardhat node
```

In another terminal:

```bash
cd CAMS-V
cd "Mode A"
node scripts/prepare.js 100 3 1
node scripts/run_all.js
```

---

## Run Mode B

```bash
cd CAMS-V
cd "Mode B"
npm install
npx hardhat node
```

In another terminal:

```bash
cd CAMS-V
cd "Mode B"
node scripts/prepare.js 100 3 1
node scripts/run_all.js
```

---

## Run Mode C

```bash
cd CAMS-V
cd "Mode C"
npm install
npx hardhat node
```

In another terminal:

```bash
cd CAMS-V
cd "Mode C"
node scripts/prepare.js 100 3 1 3 2
node scripts/run_all.js
```

---

# Retrieve Ballot Data from IPFS

After vote submission, encrypted ballots are uploaded to IPFS.

The CID of each ballot is stored in the generated output files under the `data/` directory.

For example, a stored ballot record may contain:

```json
{
  "cid": "QmXDZmPr5Fsb37qMbN3Jd3PSEp19mFsrEyt6BcFX3ABuKB"
}
```

Copy the CID and retrieve the stored ballot content using the local IPFS gateway:

```text
http://localhost:8080/ipfs/<CID>
```

Example:

```text
http://localhost:8080/ipfs/QmXDZmPr5Fsb37qMbN3Jd3PSEp19mFsrEyt6BcFX3ABuKB
```

Open the link in a browser to view the stored ballot data.

---

# Notes

* Keep the Hardhat node running while executing the workflow.
* Keep the IPFS daemon running while executing the workflow.
* Run commands inside the selected mode folder.
* Mode A and Mode B use three preparation parameters.
* Mode C uses five preparation parameters because it requires trustee and threshold configuration.
* If the folder name contains a space, wrap it in quotes, such as `cd "Mode A"`.

---

# Contributors

* **Leader**: M.Sc. IT. Khoa Tan VO
* **Members**: Phi-Thong Vo-Van, Quang-Vu Pham
