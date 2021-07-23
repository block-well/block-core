import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deploy } from "../tasks";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const sats = await deployments.get("SATS");
    await deploy(hre, "SwapFee", {
        from: deployer,
        args: [0, 20, 50, 321784, sats.address],
        log: true,
    });

    const system = await deploy(hre, "DeCusSystem", {
        from: deployer,
        args: [],
        log: true,
    });

    const dcs = await deployments.get("DCS");
    await deploy(hre, "SwapRewarder", {
        from: deployer,
        args: [dcs.address, system.address],
        log: true,
    });
};

export default func;
func.tags = ["All", "System"];
func.dependencies = ["Token"];
