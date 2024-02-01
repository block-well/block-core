const { ethers, upgrades } = require("hardhat");

async function main() {
  // Deploying
  const SwapFeeSats = await ethers.getContractFactory("SwapFeeSats");
  const instance = await upgrades.deployProxy(SwapFeeSats, [0, 0, 0, 0,"0x96D9EBC3AF2DE1E4F0203ccDA0419fD077B5AA71"], { initializer: 'initialize' });
  await instance.waitForDeployment();
  console.log('SwapFeeSats deployed to:',instance.target);
  const version = await instance.getVersion();
  console.log("Version: ", version)
}

main();