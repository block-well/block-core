import { DeployFunction } from "hardhat-deploy/types";
import { network, deployments, getNamedAccounts } from "hardhat";

const func: DeployFunction = async function () {
    if (network.name == "mainnet") {
        return;
    }

    const { deployer } = await getNamedAccounts();
    await deployments.deploy("WBTC", {
        contract: "MockWBTC",
        from: deployer,
        args: [],
        log: true,
    });
};

export default func;
