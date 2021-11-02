import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { SWAP_CONFIG } from "../config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const system = await deployments.deploy("DeCusSystem", {
        from: deployer,
        args: [],
        log: true,
    });

    const dcs = await deployments.get("DCS");
    await deployments.deploy("SwapFee", {
        contract: "SwapFeeDcs",
        from: deployer,
        args: [
            hre.ethers.utils.parseEther(SWAP_CONFIG.BURN_FEE_DCS),
            SWAP_CONFIG.MINT_GAS_PRICE,
            SWAP_CONFIG.MINT_GAS_USED,
            dcs.address,
            system.address,
        ],
        log: true,
    });

    await deployments.deploy("SwapRewarder", {
        from: deployer,
        args: [
            dcs.address,
            system.address,
            hre.ethers.utils.parseEther(SWAP_CONFIG.MINT_REWARD_DCS),
            hre.ethers.utils.parseEther(SWAP_CONFIG.BURN_REWARD_DCS),
        ],
        log: true,
    });
};

export default func;
func.tags = ["All", "System"];
func.dependencies = ["Token"];
