import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deploy } from "../tasks";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deploy(hre, "SATS", {
        from: deployer,
        args: [],
        log: true,
    });

    await deploy(hre, "DCS", {
        from: deployer,
        args: [],
        log: true,
    });
};

export default func;
func.tags = ["All", "Token"];
