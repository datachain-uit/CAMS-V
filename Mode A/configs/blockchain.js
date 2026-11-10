const hre = require("hardhat");

const VOTING_ADDRESS = "0x4A679253410272dd5232B3Ff7cF5dbB88f295319";
const TALLY_VERIFIER_ADDRESS = "0x7a2088a1bFc9d81c55368AE168C2C02570cB814F";

async function getContract(signerIndex = 0) {
  const signers = await hre.ethers.getSigners();
  const signer = signers[signerIndex];

  const votingAbi =
    require("../artifacts/contracts/E_Voting.sol/E_Voting.json").abi;

  const tallyVerifierAbi =
    require("../artifacts/contracts/TallyVerifier.sol/TallyVerifierOnChain.json").abi;

  const votingContract = new hre.ethers.Contract(
    VOTING_ADDRESS,
    votingAbi,
    signer,
  );

  const tallyVerifierContract = new hre.ethers.Contract(
    TALLY_VERIFIER_ADDRESS,
    tallyVerifierAbi,
    signer,
  );

  return {
    signer,
    votingContract,
    tallyVerifierContract,
  };
}

module.exports = { getContract };
