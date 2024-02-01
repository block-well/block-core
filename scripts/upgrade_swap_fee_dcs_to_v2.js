const { ethers, upgrades } = require("hardhat");

async function main() {
  // Deploying
  const SwapFeeDcsV2 = await ethers.getContractFactory("SwapFeeDcsV2");
  const instance = await upgrades.upgradeProxy("0xFf013054037B6B139184150e9651E31c7B8aA6B5", SwapFeeDcsV2);
  console.log('SwapFeeDcs upgraded');
  const version = await instance.getVersion();
  console.log("Version: ", version)
}

main();
