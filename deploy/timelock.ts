import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    // const delay = 3600 * 24 * 2; // 2 days
    const delay = 15 * 60; // TODO: 15 minutes for test
    const timelockController = await deployments.deploy("TimelockController", {
        from: deployer,
        args: [delay, [deployer], [deployer], hre.ethers.constants.AddressZero],
        log: true,
    });

    // DeCusSystem
    await deployments.execute(
        "DeCusSystem",
        { from: deployer, log: true },
        "grantRole",
        hre.ethers.constants.HashZero,
        timelockController.address
    );
    await deployments.execute(
        "DeCusSystem",
        { from: deployer, log: true },
        "revokeRole",
        hre.ethers.constants.HashZero,
        deployer
    );

    // KeeperRegistry
    await deployments.execute(
        "KeeperRegistry",
        { from: deployer, log: true },
        "transferOwnership",
        timelockController.address
    );

    // BtcRater
    await deployments.execute(
        "BtcRater",
        { from: deployer, log: true },
        "transferOwnership",
        timelockController.address
    );

    // SATS
    await deployments.execute(
        "SATS",
        { from: deployer, log: true },
        "grantRole",
        hre.ethers.constants.HashZero,
        timelockController.address
    );
    await deployments.execute(
        "SATS",
        { from: deployer, log: true },
        "revokeRole",
        hre.ethers.constants.HashZero,
        deployer
    );

    // DCS: we will transfer dcs's owner manually later after all allocation has been done

    // SwapFee: we will do it after all setup
    // await deployments.execute(
    //     "SwapFee",
    //     { from: deployer, log: true },
    //     "transferOwnership",
    //     timelockController.address
    // );
};

export default func;
func.tags = ["All", "Timelock"];
func.dependencies = ["Init", "System", "Token", "Keeper"];
func.skip = async () => {
    return Boolean(process.env.SKIP_TIMELOCK);
};
