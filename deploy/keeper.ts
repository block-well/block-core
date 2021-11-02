import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { KEEPER_CONFIG } from "../config";

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
    const minKeeperCollateral = KEEPER_CONFIG.UNIT_AMOUNT;
    await deployments.deploy("KeeperRegistry", {
        from: deployer,
        args: [
            [btcAddress],
            sats.address,
            rater.address,
            hre.ethers.utils.parseEther(minKeeperCollateral),
        ],
        log: true,
    });
};

export default func;
func.tags = ["All", "Keeper"];
func.dependencies = ["TestToken", "Token"];
