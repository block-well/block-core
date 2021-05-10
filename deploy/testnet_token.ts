import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployments.deploy("WBTC", {
        contract: "MockWBTC",
        from: deployer,
        args: [],
        log: true,
    });
};

export default func;
func.tags = ["TestToken"];
func.skip = async (hre) => {
    return hre.network.name == "mainnet";
};
