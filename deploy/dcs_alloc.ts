import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const rewarder = await deployments.get("SwapRewarder");

    await deployments.execute(
        "DCS",
        { from: deployer, log: true },
        "mint",
        rewarder.address,
        ethers.utils.parseEther("4000000") // initial allocation
    );
};

export default func;
func.tags = ["All", "Alloc"];
func.dependencies = ["System", "Token", "Keeper", "Init"];
