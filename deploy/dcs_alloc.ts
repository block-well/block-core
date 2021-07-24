import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { KeeperRewarder } from "../build/typechain";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const swapRewarder = await deployments.get("SwapRewarder");

    // const dcs = await deployments.get("DCS");
    await deployments.execute(
        "DCS",
        { from: deployer, log: true },
        "mint",
        swapRewarder.address,
        ethers.utils.parseEther("4000000") // initial allocation
    );

    const rate = BigNumber.from("2378234398782344000"); // 6250000 token per month at the beginning
    const keeperRewarder = (await ethers.getContract("KeeperRewarder")) as KeeperRewarder;
    const supply = (await keeperRewarder.endTimestamp())
        .sub(await keeperRewarder.startTimestamp())
        .mul(rate);

    await deployments.execute("DCS", { from: deployer, log: true }, "mint", deployer, supply);

    await deployments.execute(
        "DCS",
        { from: deployer, log: true },
        "approve",
        keeperRewarder.address,
        supply
    );

    await deployments.execute("KeeperRewarder", { from: deployer, log: true }, "updateRate", rate);
};

export default func;
func.tags = ["All", "Alloc"];
func.dependencies = ["System", "Token", "Keeper", "Init"];
func.skip = async (hre) => {
    return Boolean(process.env.HD_WALLET_PATH) && hre.network.name != "hardhat";
};
