import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deploy } from "../tasks";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const wbtc = await deployments.get("WBTC");
    await deploy(hre, "BtcRater", {
        from: deployer,
        args: [[wbtc.address], [1]],
        log: true,
    });

    const sats = await deployments.get("SATS");
    const rater = await deployments.get("BtcRater");
    const registry = await deploy(hre, "KeeperRegistry", {
        from: deployer,
        args: [[wbtc.address], sats.address, rater.address],
        log: true,
    });

    const dcs = await deployments.get("DCS");
    const now = Math.round(new Date().getTime() / 1000);
    const rewardStart = now + 30 * 60;
    const rewardEnd = rewardStart + 2 * 365 * 60 * 60 * 24;
    // console.log("Keeper reward start", rewardStart, "end", rewardEnd);
    await deploy(hre, "KeeperRewarder", {
        from: deployer,
        args: [dcs.address, registry.address, rewardStart, rewardEnd],
        log: true,
    });
};

export default func;
func.tags = ["All", "Keeper"];
func.dependencies = ["TestToken", "Token"];
