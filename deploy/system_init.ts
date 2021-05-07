import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const ebtc = await deployments.get("EBTC");
    const registry = await deployments.get("KeeperRegistry");

    await deployments.execute(
        "DeCusSystem",
        { from: deployer, log: true },
        "initialize",
        ebtc.address,
        registry.address
    );
};

export default func;
func.tags = ["All", "Init"];
func.dependencies = ["System", "Token", "Keeper"];
