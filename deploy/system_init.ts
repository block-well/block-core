import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const cong = await deployments.get("CONG");
    const decusSystem = await deployments.get("DeCusSystem");

    await deployments.execute(
        "CONG",
        { from: deployer, log: true },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        decusSystem.address
    );

    const registry = await deployments.get("KeeperRegistry");

    await deployments.execute(
        "DeCusSystem",
        { from: deployer, log: true },
        "initialize",
        cong.address,
        registry.address
    );
};

export default func;
func.tags = ["All", "Init"];
func.dependencies = ["System", "Token", "Keeper"];
