import { ethers, upgrades } from "hardhat";

const SwapFee_PROXY_ADDRESS = "0x80F48E7c24bb2868B94B48163794d95Cd6bACd76";
async function main() {
    const SwapFeeSats = await ethers.getContractFactory("SwapFeeSatsUpgradeable");
    const swapFeeSats = await upgrades.upgradeProxy(SwapFee_PROXY_ADDRESS, SwapFeeSats);
    await swapFeeSats.upgradeIntianlization(
        4,
        5,
        6,
        7,
        "0x00000000000000000000000000000000000000bb"
    );

    console.log("Box upgraded");
}

main();
