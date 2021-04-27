import { HardhatUserConfig, NetworksUserConfig } from "hardhat/types";
import "@nomiclabs/hardhat-waffle";
import "solidity-coverage";
import "hardhat-gas-reporter";

const networks: NetworksUserConfig = {
    hardhat: {},
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
    // @see https://hardhat.org/plugins/hardhat-gas-reporter.html
    gasReporter: {
        enabled: true,
        currency: "USD",
        noColors: true,
        coinmarketcap: "7ac7b370-2b6d-401b-8556-b65869c984db",
    },
};
export default config;
