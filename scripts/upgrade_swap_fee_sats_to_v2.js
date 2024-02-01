const { ethers, upgrades } = require("hardhat");

async function main() {
  // Deploying
  const SwapFeeSatsV2 = await ethers.getContractFactory("SwapFeeSatsV2");
  const instance = await upgrades.upgradeProxy("0xb666627fAcBD41bDCAD525E378F264D3a2F8836c", SwapFeeSatsV2);
  console.log('SwapFeeSats upgraded');
  const version = await instance.getVersion();
  console.log("Version: ", version)
}

main();