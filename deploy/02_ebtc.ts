import { DeployFunction } from "hardhat-deploy/types";
import { deployments, getNamedAccounts } from "hardhat";

const func: DeployFunction = async function () {
    const { deployer } = await getNamedAccounts();

    await deployments.deploy("EBTC", {
        from: deployer,
        args: [],
        log: true,
    });
};

export default func;
