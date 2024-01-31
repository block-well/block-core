import { ethers, upgrades } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployOrUpgrade: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployProxy } = upgrades;
    const { deployer } = await getNamedAccounts();
    const deployerSigner = await ethers.getSigner(deployer);

    const mintFeeGasPrice: number = 2000;
    const mintFeeGasUsed: number = 10000;
    const burnFeeDcs: number = 1000;
    const dcs: string = "0x0000000000000000000000000000000000000001";
    const system: string = "0x0000000000000000000000000000000000000002";
    const dcsAddress = ethers.utils.getAddress(dcs);
    const systemAddress = ethers.utils.getAddress(system);
    const abi = new ethers.utils.AbiCoder();
    const data0 = abi.encode(
        ["uint16", "uint32", "uint256", "address", "address"],
        [mintFeeGasPrice, mintFeeGasUsed, burnFeeDcs, dcsAddress, systemAddress]
    );

    const SwapFeeDcs = await ethers.getContractFactory("SwapFeeDcs");
    console.log("Before deployProxy");
    const swapFeeDcs = await deployProxy(SwapFeeDcs, [data0], {
        kind: "uups",
    });
    console.log("After deployProxy");
    await swapFeeDcs.deployed();
    const ideaManagerImplAddr = await upgrades.erc1967.getImplementationAddress(swapFeeDcs.address);
    console.log("SwapFeeDcs proxy:", swapFeeDcs.address);
    console.log("SwapFeeDcs impl:", ideaManagerImplAddr);

    const proxyAddress = swapFeeDcs.address;

    // Deploy the new logic contract
    const SwapFeeSatsFactory = await ethers.getContractFactory("SwapFeeSats", deployer);
    const swapFeeSats = await SwapFeeSatsFactory.deploy();
    await swapFeeSats.deployed();
    console.log("Deployed SwapFeeSats logic contract at:", swapFeeSats.address);

    // Prepare data for upgradeToAndCall
    const mintFeeBps = 200; // Example value in wei for 2 gwei
    const burnFeeBps = 120; // Example value
    const newSats = "0x0000000000000000000000000000000000000003"; // Example address
    const data = swapFeeSats.interface.encodeFunctionData("setNewValues", [
        mintFeeBps,
        burnFeeBps,
        newSats,
    ]);

    // Use the proxy contract to call upgradeToAndCall
    const proxyContract = await ethers.getContractAt("SwapFeeSats", proxyAddress, deployerSigner);
    const tx = await proxyContract.upgradeToAndCall(swapFeeSats.address, data);
    await tx.wait();

    console.log("Upgrade transaction hash:", tx.hash);
};

export default deployOrUpgrade;
deployOrUpgrade.tags = ["UpgradeSwapFeeSats"];
