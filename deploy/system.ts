import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const system = await deployments.deploy("DecuxSystem", {
        from: deployer,
        args: [],
        log: true,
    });

    const dcx = await deployments.get("DCX");
    const ebtc = await deployments.get("EBTC");
    await deployments.deploy("SwapFee", {
        contract: "SwapFeeEbtc",
        from: deployer,
        args: [0, 0, 30, 300000, ebtc.address], // TODO: check value before deploy
        log: true,
    });

    await deployments.deploy("SwapRewarder", {
        from: deployer,
        args: [dcx.address, system.address, 0, 0], // TODO: check value before deploy
        log: true,
    });
};

export default func;
func.tags = ["All", "System"];
func.dependencies = ["Token"];
