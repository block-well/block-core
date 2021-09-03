import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer, btc } = await getNamedAccounts();

    const sats = await deployments.get("SATS");

    const btcAddress = btc ? btc : (await deployments.get("BTC")).address;
    await deployments.deploy("BtcRater", {
        from: deployer,
        args: [
            [btcAddress, sats.address],
            [1, 1e8],
        ],
        log: true,
    });

    const rater = await deployments.get("BtcRater");
    const minKeeperCollateral = ["mainnet", "bsc"].includes(hre.network.name) ? "0.1" : "0.0001"; // TODO: check value before deploy
    const registry = await deployments.deploy("KeeperRegistry", {
        from: deployer,
        args: [
            [btcAddress],
            sats.address,
            rater.address,
            hre.ethers.utils.parseEther(minKeeperCollateral),
        ],
        log: true,
    });

    const dcs = await deployments.get("DCS");
    const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
    const rewardStart = now + 30 * 60;
    const rewardEnd = rewardStart + 2 * 365 * 60 * 60 * 24;
    deployments.log("Keeper reward start", rewardStart, "end", rewardEnd);
    await deployments.deploy("KeeperReward", {
        from: deployer,
        args: [
            dcs.address,
            registry.address,
            rewardStart,
            rewardEnd,
            process.env.KEEPER_REWARD_VALIDATOR ?? hre.ethers.constants.AddressZero,
        ],
        log: true,
    });
};

export default func;
func.tags = ["All", "Keeper"];
func.dependencies = ["TestToken", "Token"];
