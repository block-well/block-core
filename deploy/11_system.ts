import { DeployFunction } from "hardhat-deploy/types";
import { ethers, deployments, getNamedAccounts } from "hardhat";

const func: DeployFunction = async function () {
    const { deployer } = await getNamedAccounts();

    await deployments.deploy("DeCusSystem", {
        from: deployer,
        args: [],
        log: true,
    });

    const decusSystem = await deployments.get("DeCusSystem");
    await deployments.execute(
        "EBTC",
        { from: deployer, log: true },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        decusSystem.address
    );

    const ebtc = await deployments.get("EBTC");
    const registry = await deployments.get("KeeperRegistry");
    await deployments.execute(
        "DeCusSystem",
        { from: deployer, log: true },
        "initialize",
        ebtc.address,
        registry.address
    );
};

export default func;
