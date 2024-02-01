const { ethers, upgrades } = require("hardhat");

async function main() {
  // Deploying
  const SwapFeeDcsV2 = await ethers.getContractFactory("SwapFeeDcsV2");
  const instance = await upgrades.upgradeProxy("0x053fA738b724d8d5d45856136FAe81F298b504a8", SwapFeeDcsV2);
  console.log('SwapFeeDcs upgraded');
  const version = await instance.getVersion();
  console.log("Version: ", version)
}

main();
