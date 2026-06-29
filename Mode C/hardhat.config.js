require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.20",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      timeout: 1000000,
      blockGasLimit: 100000000,

    },
    hardhat: {
      blockGasLimit: 100000000,
      timeout: 1000000,

    },
  },
};
