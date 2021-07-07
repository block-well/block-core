import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const sats = await deployments.deploy("SATS", {
        from: deployer,
        args: [],
        log: true,
    });

    await deployments.deploy("SwapFee", {
        from: deployer,
        args: [0, 20, 50, 321784, sats.address],
        log: true,
    });
};

export default func;
func.tags = ["All", "Token"];
