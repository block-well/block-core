import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const wbtc = await deployments.get("WBTC");
    const ebtc = await deployments.get("EBTC");

    await deployments.deploy("KeeperRegistry", {
        from: deployer,
        args: [[wbtc.address], ebtc.address],
        log: true,
    });
};

export default func;
func.tags = ["All", "Keeper"];
func.dependencies = ["TestToken", "Token"];
