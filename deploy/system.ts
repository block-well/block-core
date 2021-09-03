import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const sats = await deployments.get("SATS");
    await deployments.deploy("SwapFee", {
        from: deployer,
        args: [0, 20, 10, 300000, sats.address], // TODO: check value before deploy
        log: true,
    });

    const system = await deployments.deploy("DeCusSystem", {
        from: deployer,
        args: [],
        log: true,
    });

    const dcs = await deployments.get("DCS");
    await deployments.deploy("SwapRewarder", {
        from: deployer,
        args: [
            dcs.address,
            system.address,
            hre.ethers.utils.parseEther("40"),
            hre.ethers.utils.parseEther("10"),
        ], // TODO: check value before deploy
        log: true,
    });
};

export default func;
func.tags = ["All", "System"];
func.dependencies = ["Token"];
