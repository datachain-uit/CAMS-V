const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const DEPLOYMENT_FILE = path.join(__dirname, "../data/deployments.json");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Deployer: ${deployer.address}`);

  const EVoting = await hre.ethers.getContractFactory("E_Voting");
  const evoting = await EVoting.deploy();
  await evoting.waitForDeployment();

  const Tally = await hre.ethers.getContractFactory("TallyVerifierOnChain");
  const tally = await Tally.deploy();
  await tally.waitForDeployment();

  const votingAddress = await evoting.getAddress();
  const tallyAddress = await tally.getAddress();

  fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  fs.writeFileSync(
    DEPLOYMENT_FILE,
    JSON.stringify(
      {
        network: hre.network.name,
        deployer: deployer.address,
        votingAddress,
        tallyAddress,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`E_Voting: ${votingAddress}`);
  console.log(`TallyVerifierOnChain: ${tallyAddress}`);
  console.log(`Deployment file: ${DEPLOYMENT_FILE}`);

  process.exit(0);
}

main().catch((error) => {
  console.error("Deploy failed:");
  console.error(error);
  process.exit(1);
});
