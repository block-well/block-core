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
        only: [":DeCusSystem$", ":KeeperRegistry$"],
        spacing: 2,
    },
    namedAccounts: {
        deployer: 0,
    },
};

const etherscanKey = process.env.ETHERSCAN_API_KEY;
if (etherscanKey) {
    config.etherscan = { apiKey: etherscanKey };
}

const infuraId = process.env.INFURA_PROJECT_ID;
if (infuraId) {
    const privateKey = `0x${process.env.PRIVATE_KEY}`;
    config.networks = {
        ...config.networks,
        main: {
            url: `https://mainnet.infura.io/v3/${infuraId}`,
            accounts: [privateKey],
        },
        kovan: {
            url: `https://kovan.infura.io/v3/${infuraId}`,
            accounts: [privateKey],
        },
        ropsten: {
            url: `https://ropsten.infura.io/v3/${infuraId}`,
            accounts: [privateKey],
        },
        bsct: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            accounts: [privateKey],
            chainId: 97,
            gasMultiplier: 2,
            // gasPrice: 20e9,
        },
    };
}

export default config;
