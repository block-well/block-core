import { task, types } from "hardhat/config";
import { KeeperRegistry, ERC20 } from "../build/typechain";
import { NonceManager } from "@ethersproject/experimental";

task("addKeeper", "add keeper")
    .addParam("privKey", "Keeper private key")
    .addParam("amount", "Keeper collateral amount in BTC", "0.01", types.string)
    .addOptionalParam("asset", "WBTC or other BTC", "WBTC")
    .setAction(async ({ privKey, amount, asset }, { ethers }) => {
        const nonceManager = new NonceManager(new ethers.Wallet(privKey, ethers.provider));
        const keeper = await nonceManager.getAddress();

        const btc = (await ethers.getContract(asset, nonceManager)) as ERC20;
        const registry = (await ethers.getContract(
            "KeeperRegistry",
            nonceManager
        )) as KeeperRegistry;

        if ((await registry.getCollateralValue(keeper)).gt(0)) {
            console.log(`keeper exist: ${keeper}`);
            return;
        }

        const num = ethers.utils.parseUnits(amount, await btc.decimals());
        let tx = await btc.approve(registry.address, num);
        console.log(`${keeper} approve at ${tx.hash}`);

        tx = await registry.addKeeper(btc.address, num);
        console.log(`${keeper} added at ${tx.hash}`);
    });
