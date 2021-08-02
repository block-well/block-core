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

    const sats = await deployments.get("SATS");
    const rater = await deployments.get("BtcRater");
    const registry = await deployments.deploy("KeeperRegistry", {
        from: deployer,
        args: [[wbtc.address], sats.address, rater.address],
        log: true,
    });

    const dcs = await deployments.get("DCS");
    const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
    const rewardStart = now + 30 * 60;
    const rewardEnd = rewardStart + 2 * 365 * 60 * 60 * 24;
    console.log("Keeper reward start", rewardStart, "end", rewardEnd);
    await deployments.deploy("KeeperRewarder", {
        from: deployer,
        args: [dcs.address, registry.address, rewardStart, rewardEnd],
        log: true,
    });
};

export default func;
func.tags = ["All", "Keeper"];
func.dependencies = ["TestToken", "Token"];
