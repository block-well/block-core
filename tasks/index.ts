import { task, types } from "hardhat/config";
import { KeeperRegistry, DeCusSystem, ERC20 } from "../build/typechain";
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

        tx = await registry.addKeeper(btc.address, num, { gasPrice: 1e9, gasLimit: 1e6 });
        console.log(`${keeper} added at ${tx.hash}`);
    });

task("groupStatus", "print status of all groups").setAction(async (args, { ethers }) => {
    const decusSystem = (await ethers.getContract("DeCusSystem")) as DeCusSystem;
    const events = await decusSystem.queryFilter(
        decusSystem.filters.GroupAdded(null, null, null, null)
    );
    console.log(`DeCusSystem: ${decusSystem.address}`);

    const groupIds = events
        .map((e) => e.args.btcAddress)
        .filter((elem, index, self) => {
            return index === self.indexOf(elem);
        });
    const now = (await decusSystem.provider.getBlock("latest")).timestamp;

    for (const groupId of groupIds) {
        const group = await decusSystem.getGroup(groupId);
        if (group.required.eq(0)) {
            continue;
        }

        const receipt = await decusSystem.getReceipt(group.workingReceiptId);
        const updateTime = receipt.updateTimestamp.toNumber();
        let minable = "false";

        if (receipt.status == 0) {
            if (updateTime + (await decusSystem.GROUP_REUSING_GAP()).toNumber() < now) {
                minable = "true";
            }
        } else if (receipt.status == 1) {
            if (updateTime + (await decusSystem.MINT_REQUEST_GRACE_PERIOD()).toNumber() < now) {
                minable = "true (force)";
            }
        } else if (receipt.status == 3) {
            if (updateTime + (await decusSystem.WITHDRAW_VERIFICATION_END()).toNumber() < now) {
                minable = "true (force)";
            }
        }

        const date = new Date(updateTime * 1000);
        console.log(`${groupId} : ${receipt.status} : ${date} : ${minable}`);
    }
});
