import { ethers, upgrades } from "hardhat";

async function main() {
    const SwapFeeDcsUpgradeable = await ethers.getContractFactory("SwapFeeDcsUpgradeable");
    const swapFeeProxy = await upgrades.deployProxy(SwapFeeDcsUpgradeable, [
        1,
        2,
        3,
        "0x304dC65b123D61A86CBE35555f4F8C79eeB812A9",
        "0x304dC65b123D61A86CBE35555f4F8C79eeB812A9",
    ]);
    const swapFee = await swapFeeProxy.deployed();
    console.log("SwapFee deployed to:", swapFee.address);
}

main();
