import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const sats = await deployments.get("SATS");
    const decusSystem = await deployments.get("DeCusSystem");

    await deployments.execute(
        "SATS",
        { from: deployer, log: true },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        decusSystem.address
    );

    await deployments.execute(
        "KeeperRegistry",
        { from: deployer, log: true },
        "setSystem",
        decusSystem.address
    );
    const registry = await deployments.get("KeeperRegistry");

    const rewarder = await deployments.get("SwapRewarder");

    const fee = await deployments.get("SwapFee");

    await deployments.execute(
        "DeCusSystem",
        { from: deployer, log: true },
        "initialize",
        sats.address,
        registry.address,
        rewarder.address,
        fee.address
    );
};

export default func;
func.tags = ["All", "Init"];
func.dependencies = ["System", "Token", "Keeper"];
func.skip = async (hre) => {
    return Boolean(process.env.DEPLOYER_HW_PATH) && hre.network.name != "hardhat";
};
