import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deploy } from "../tasks";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deploy(hre, "WBTC", {
        contract: "MockWBTC",
        from: deployer,
        args: [],
        log: true,
    });
};

export default func;
func.tags = ["TestToken"];
func.skip = async (hre) => {
    return hre.network.name == "mainnet";
};
