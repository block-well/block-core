import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const TOTAL_SUPPLY = hre.ethers.utils.parseEther("1000000000");

    await deployments.deploy("EBTC", {
        from: deployer,
        args: [],
        log: true,
    });

    await deployments.deploy("DCX", {
        from: deployer,
        args: [TOTAL_SUPPLY, deployer],
        log: true,
    });
};

export default func;
func.tags = ["All", "Token"];
