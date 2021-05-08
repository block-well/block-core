import { HardhatUserConfig, NetworksUserConfig } from "hardhat/types";
import "@nomiclabs/hardhat-waffle";
import "solidity-coverage";
import "hardhat-gas-reporter";
import "hardhat-typechain";
import "hardhat-deploy";

const networks: NetworksUserConfig = {
    hardhat: {
        saveDeployments: false,
    },
    localhost: {},
};

const config: HardhatUserConfig = {
    networks: networks,
    solidity: {
        version: "0.6.12",
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
        kovan: {
            url: `https://kovan.infura.io/v3/${infuraId}`,
            accounts: [privateKey],
            throwOnTransactionFailures: true,
            throwOnCallFailures: true,
        },
        ropsten: {
            url: `https://ropsten.infura.io/v3/${infuraId}`,
            accounts: [privateKey],
            throwOnTransactionFailures: true,
            throwOnCallFailures: true,
        },
    };
}

export default config;
