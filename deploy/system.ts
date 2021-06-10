import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployments.deploy("Fee", {
        from: deployer,
        args: [0, 0],
        log: true,
    });

    await deployments.deploy("DeCusSystem", {
        from: deployer,
        args: [],
        log: true,
    });
};

export default func;
func.tags = ["All", "System"];
