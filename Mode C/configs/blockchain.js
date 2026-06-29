const hre = require("hardhat");

const VOTING_ADDRESS = "0x7a2088a1bFc9d81c55368AE168C2C02570cB814F";
const TALLY_VERIFIER_ADDRESS = "0x09635F643e140090A9A8Dcd712eD6285858ceBef";

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
