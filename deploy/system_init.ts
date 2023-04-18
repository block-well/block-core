import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const ebtc = await deployments.get("EBTC");
    const decusSystem = await deployments.get("DecuxSystem");

    await deployments.execute(
        "EBTC",
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
        "DecuxSystem",
        { from: deployer, log: true },
        "initialize",
        ebtc.address,
        registry.address,
        rewarder.address,
        fee.address
    );
};

export default func;
func.tags = ["All", "Init"];
func.dependencies = ["System", "Token", "Keeper"];
