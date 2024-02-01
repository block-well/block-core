const { ethers, upgrades } = require("hardhat");

async function main() {
  // Deploying
  const SwapFeeSatsV2 = await ethers.getContractFactory("SwapFeeSatsV2");
  const instance = await upgrades.upgradeProxy("0x99aB38e76E133f14CFaEFaA848Cb10d86389D5a5", SwapFeeSatsV2);
  console.log('SwapFeeSats upgraded');
  const version = await instance.getVersion();
  console.log("Version: ", version)
}

main();
