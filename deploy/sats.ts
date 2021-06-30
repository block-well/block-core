import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployments.deploy("SATS", {
        from: deployer,
        args: [],
        log: true,
    });

    const dcs = await deployments.deploy("DeCus", {
        from: deployer,
        args: [],
        log: true,
    });

    await deployments.deploy("SwapRewarder", {
        from: deployer,
        args: [dcs.address],
        log: true,
    });
};

export default func;
func.tags = ["All", "Token"];
