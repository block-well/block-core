const { ethers, upgrades } = require("hardhat");

async function main() {
  // Deploying
  const SwapFeeDcs = await ethers.getContractFactory("SwapFeeDcs");
  const instance = await upgrades.deployProxy(SwapFeeDcs, [0, 0, 0, "0x96D9EBC3AF2DE1E4F0203ccDA0419fD077B5AA71", "0x96D9EBC3AF2DE1E4F0203ccDA0419fD077B5AA71"], { initializer: 'initialize' });
  await instance.waitForDeployment();
  console.log('SwapFeeDcs deployed to:',instance.target);
  const version = await instance.getVersion();
  console.log("Version: ", version)
}

main();