import { DeployFunction } from "hardhat-deploy/types";
import { deployments, getNamedAccounts } from "hardhat";

const func: DeployFunction = async function () {
    const { deployer } = await getNamedAccounts();

    const wbtc = await deployments.get("WBTC");
    const ebtc = await deployments.get("EBTC");
    await deployments.deploy("KeeperRegistry", {
        from: deployer,
        args: [[wbtc.address], ebtc.address],
        log: true,
    });
};

export default func;
