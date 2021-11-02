import path from "path";
import fs from "fs";
import "@nomiclabs/hardhat-waffle";
import "solidity-coverage";
import "hardhat-gas-reporter";
import "hardhat-typechain";
import "hardhat-deploy";
import "hardhat-abi-exporter";
import { HardhatUserConfig, NetworksUserConfig } from "hardhat/types";

// Prevent to load scripts before compilation and typechain
if (!process.env.SKIP_LOAD) {
    const tasksPath = path.join(__dirname, "tasks");
    fs.readdirSync(tasksPath)
        .filter((pth) => pth.includes(".ts"))
        .forEach((task) => {
            require(`${tasksPath}/${task}`);
        });
}

const networks: NetworksUserConfig = {
    hardhat: {
        saveDeployments: false,
    },
    localhost: {},
};

const config: HardhatUserConfig = {
    networks: networks,
    solidity: {
        version: "0.7.6",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS ? true : false,
        excludeContracts: ["mock/"],
        currency: "USD",
        coinmarketcap: "7ac7b370-2b6d-401b-8556-b65869c984db",
    },
    paths: {
        artifacts: "./build/artifacts",
        cache: "./build/cache",
        deployments: "./deployments",
    },
    typechain: {
        outDir: "./build/typechain/",
        target: "ethers-v5",
    },
    abiExporter: {
        path: "./build/abi",
        clear: true,
        flat: true,
        only: [
            ":DeCusSystem$",
            ":KeeperRegistry$",
            ":KeeperReward$",
            ":StakingReward$",
            ":Airdrop$",
            ":StakingUnlock",
        ],
        spacing: 2,
    },
    namedAccounts: {
        deployer: 0,
        btc: {
            mainnet: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
            bsc: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
        },
    },
};

const etherscanKey = process.env.ETHERSCAN_API_KEY;
if (etherscanKey) {
    config.etherscan = { apiKey: etherscanKey };
}

const privateKey = process.env.PRIVATE_KEY;
const accounts = privateKey
    ? [`0x${privateKey}`]
    : {
          mnemonic:
              process.env.MNEMONIC ||
              "decus decus decus decus decus decus decus decus decus decus decus decus",
          count: 2,
      };

const infuraId = process.env.INFURA_PROJECT_ID;

config.networks = {
    ...config.networks,
    kovan: {
        url: `https://kovan.infura.io/v3/${infuraId}`,
        accounts,
    },
    ropsten: {
        url: `https://ropsten.infura.io/v3/${infuraId}`,
        accounts,
    },
    bsct: {
        url: "https://data-seed-prebsc-1-s2.binance.org:8545",
        accounts,
        chainId: 97,
        gasMultiplier: 2,
        // gasPrice: 20e9,
    },
    bsct2: {
        url: "https://data-seed-prebsc-1-s2.binance.org:8545",
        accounts,
        chainId: 97,
        gasMultiplier: 2,
        // gasPrice: 20e9,
    },
    bsc: {
        url: "https://bsc-dataseed1.defibit.io/",
        accounts,
        chainId: 56,
        gasPrice: 5e9,
    },
};

process.env.HARDHAT_DEPLOY_LOG = "true";

export default config;
