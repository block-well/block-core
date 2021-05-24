import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const wbtc = await deployments.get("WBTC");
    await deployments.deploy("BtcRater", {
        from: deployer,
        args: [[wbtc.address], [1]],
        log: true,
    });

    const cong = await deployments.get("CONG");
    const rater = await deployments.get("BtcRater");
    await deployments.deploy("KeeperRegistry", {
        from: deployer,
        args: [[wbtc.address], cong.address, rater.address],
        log: true,
    });
};

export default func;
func.tags = ["All", "Keeper"];
func.dependencies = ["TestToken", "Token"];
