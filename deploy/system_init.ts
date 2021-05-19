import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const ebtc = await deployments.get("EBTC");
    const decusSystem = await deployments.get("DeCusSystem");

    await deployments.execute(
        "EBTC",
        { from: deployer, log: true },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        decusSystem.address
    );

    const registry = await deployments.get("KeeperRegistry");
    const verifier = await deployments.get("Verifier");

    await deployments.execute(
        "DeCusSystem",
        { from: deployer, log: true },
        "initialize",
        ebtc.address,
        registry.address,
        verifier.address
    );
};

export default func;
func.tags = ["All", "Init"];
func.dependencies = ["System", "Token", "Keeper"];
