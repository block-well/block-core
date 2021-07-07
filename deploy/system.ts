import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const system = await deployments.deploy("DeCusSystem", {
        from: deployer,
        args: [],
        log: true,
    });

    const dcs = await deployments.deploy("DCS", {
        from: deployer,
        args: [],
        log: true,
    });

    await deployments.deploy("SwapRewarder", {
        from: deployer,
        args: [dcs.address, system.address],
        log: true,
    });
};

export default func;
func.tags = ["All", "System"];
