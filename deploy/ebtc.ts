import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const decusSystem = await deployments.get("DeCusSystem");

    await deployments.deploy("EBTC", {
        from: deployer,
        args: [decusSystem.address],
        log: true,
    });
};

export default func;
func.tags = ["All", "Token"];
func.dependencies = ["System"];
