import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const wbtcNetworks = ["ropsten", "kovan"];
    // const wbtcNetworks = ["ropsten", "kovan", "hardhat"];
    const btcContract = wbtcNetworks.includes(hre.network.name) ? "MockWBTC" : "MockBTCB";

    await deployments.deploy("BTC", {
        contract: btcContract,
        from: deployer,
        args: [],
        log: true,
    });

    await deployments.deploy("USDT", {
        contract: "MockERC20",
        from: deployer,
        args: ["USDT", "USDT", 18],
        log: true,
    });
};

export default func;
func.tags = ["TestToken"];
func.skip = async (hre) => {
    return ["mainnet", "bsc"].includes(hre.network.name);
};
