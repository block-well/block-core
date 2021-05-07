import { task, types } from "hardhat/config";
import { KeeperRegistry, ERC20 } from "../build/typechain";

task("addKeeper", "add keeper")
    .addParam("privKey", "Keeper private key")
    .addParam("amount", "Keeper collateral amount in BTC", "0.01", types.string)
    .addOptionalParam("asset", "WBTC or other BTC", "WBTC")
    .setAction(async ({ privKey, amountBTC, asset }, { ethers }) => {
        const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;
        const btc = (await ethers.getContract(asset)) as ERC20;
        const keeper = new ethers.Wallet(privKey, ethers.provider);
        const amount = ethers.utils.parseUnits(amountBTC, await btc.decimals());

        if (registry.hasKeeper(keeper.address)) {
            console.log(`keeper exist: ${keeper}`);
            return;
        }

        let tx = await btc.approve(registry.address, amount);
        console.log(`${keeper.address} approve at ${tx.hash}`);

        tx = await registry.connect(keeper).addKeeper(btc.address, amount);
        console.log(`${keeper.address} added at ${tx.hash}`);
    });
