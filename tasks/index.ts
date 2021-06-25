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

    const groupReusingGap = await decusSystem.GROUP_REUSING_GAP();
    const mintRequestGracePeriod = await decusSystem.MINT_REQUEST_GRACE_PERIOD();
    const withdrawVerificationEnd = await decusSystem.WITHDRAW_VERIFICATION_END();

    for (const groupId of groupIds) {
        const group = await decusSystem.getGroup(groupId);
        if (group.required.eq(0)) {
            continue;
        }

        const receipt = await decusSystem.getReceipt(group.workingReceiptId);
        const updateTime = receipt.updateTimestamp;
        let minable = "false";

        if (receipt.status == 0) {
            if (updateTime + groupReusingGap < now) {
                minable = "true";
            }
        } else if (receipt.status == 1) {
            if (updateTime + mintRequestGracePeriod < now) {
                minable = "true (force)";
            }
        } else if (receipt.status == 3) {
            if (updateTime + withdrawVerificationEnd < now) {
                minable = "true (force)";
            }
        }

        const date = new Date(updateTime * 1000);
        console.log(`${groupId} : ${receipt.status} : ${date} : ${minable}`);
    }
});

task("traceReceipt", "get receipt history")
    .addParam("id", "receiptId")
    .setAction(async ({ id }, { ethers }) => {
        const decusSystem = (await ethers.getContract("DeCusSystem")) as DeCusSystem;
        const mintEvents = await decusSystem.queryFilter(
            decusSystem.filters.MintRequested(id, null, null, null)
        );
        const recipient = mintEvents[0].args.recipient;
        const groupBtcAddress = mintEvents[0].args.groupBtcAddress;
        const mintBlock = mintEvents[0].blockNumber;
        const mintTimestamp = new Date((await mintEvents[0].getBlock()).timestamp * 1000);
        console.log(
            `MintRequested: ${mintBlock} ${recipient} ${groupBtcAddress} ${mintTimestamp} ${mintEvents[0].transactionHash}`
        );

        const verifyEvents = await decusSystem.queryFilter(
            decusSystem.filters.MintVerified(id, null, null, null, null)
        );

        if (verifyEvents.length > 0) {
            const verifyBlock = verifyEvents[0].blockNumber;
            const verifyTimestamp = new Date((await verifyEvents[0].getBlock()).timestamp * 1000);
            console.log(
                `VerifyBlock: ${verifyBlock} ${verifyTimestamp} ${verifyEvents[0].transactionHash}`
            );
        }
    });

task("traceMREvents", "get all MintRequested events").setAction(async (args, { ethers }) => {
    const decusSystem = (await ethers.getContract("DeCusSystem")) as DeCusSystem;
    const events = await decusSystem.queryFilter(
        decusSystem.filters.MintRequested(null, null, null, null)
    );
    console.log(`blocknumber,timestamp,receiptId,recipient,group`);
    for (const event of events) {
        const blockNumber = event["blockNumber"];
        const timestamp = (await decusSystem.provider.getBlock(blockNumber)).timestamp;
        const receiptId = event["args"]["receiptId"];
        const recipient = event["args"]["recipient"];
        const group = event["args"]["groupBtcAddress"];
        console.log(`${blockNumber},${timestamp},${receiptId},${recipient},${group}`);
    }
});

// task("traceMVEvents", "get all MintVerified events").setAction(async (args, { ethers }) => {
//     const decusSystem = (await ethers.getContract("DeCusSystem")) as DeCusSystem;
//     const events = await decusSystem.queryFilter(
//         decusSystem.filters.MintVerified(null, null, null, null, null)
//     );
//     console.log(`blocknumber,timestamp,receiptId,recipient,group,btcTxId,btcSender`);
//     for (const event of events) {
//         const blockNumber = event["blockNumber"];
//         const timestamp = (await decusSystem.provider.getBlock(blockNumber)).timestamp;
//         const receiptId = event["args"]["receiptId"];
//         const receipt = await decusSystem.getReceipt(receiptId);
//         console.log(receiptId);
//         console.log(receipt);
//         const recipient = receipt["recipient"];
//         const group = receipt["groupBtcAddress"];
//         const btcTxId = receipt["txId"];
//         // console.log(`${blockNumber},${timestamp},${receiptId},${recipient},${group},${btcTxId}`);
//     }
// });
