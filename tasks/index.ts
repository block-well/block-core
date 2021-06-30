import { task, types } from "hardhat/config";
import { KeeperRegistry, DeCusSystem, ERC20 } from "../build/typechain";
import { NonceManager } from "@ethersproject/experimental";
import dayjs from "dayjs";
import axios from "axios";

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

        if ((await registry.getCollateralWei(keeper)).gt(0)) {
            console.log(`keeper exist: ${keeper}`);
            return;
        }

        const num = ethers.utils.parseUnits(amount, await btc.decimals());
        let tx = await btc.approve(registry.address, num, { gasPrice: 1e9, gasLimit: 1e6 });
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
    console.log(`total groups: ${groupIds.length}`);

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

const getBtcUtxoUrl = (network: string, address: string) => {
    return `https://blockstream.info/${network}/api/address/${address}/utxo`;
};

const formatTimestamp = (timestamp: number) => {
    return dayjs(timestamp * 1000).format("YYYY.MM.DDTHH:mm:ss");
};

const findUtxo = (utxos: any, afterTimestamp: number) => {
    for (const utxo of utxos) {
        if (utxo.status.block_time > afterTimestamp) {
            // console.log("utxo", utxo);
            return utxo;
        }
    }
};

const getDepositSignUrl = (network: string, receiptId: string) => {
    const domain = network == "kovan" ? "online" : "io"; // temporarily working, need to reconsider after launching mainnet
    return `http://coordinator.decus.${domain}/deposit/status/${receiptId}`;
};

const findWorkingReceiptId = async (btcAddress: string, system: DeCusSystem): Promise<string> => {
    const group = await system.getGroup(btcAddress);
    return group.workingReceiptId;
};

task("traceMint", "get receipt history")
    .addOptionalParam("id", "receiptId")
    .addOptionalParam("btcAddress", "btc group address")
    .setAction(async ({ id, btcAddress }, { ethers, network }) => {
        const btcNetwork = network.name == "mainnet" ? "mainnet" : "testnet";
        const decusSystem = (await ethers.getContract("DeCusSystem")) as DeCusSystem;

        if (!id && !btcAddress) {
            throw new Error("Please specify either id or btcAddress");
        }

        if (!id) {
            id = await findWorkingReceiptId(btcAddress, decusSystem);
            if (!id) {
                throw new Error(`Unable to find working receipt id related to ${btcAddress}`);
            }
        }

        console.log("network:", network.name, "receiptId:", id, "btc:", btcNetwork);

        // 1. request mint
        const mintEvents = await decusSystem.queryFilter(
            decusSystem.filters.MintRequested(id, null, null, null)
        );
        if (mintEvents.length == 0) throw new Error(`receipt not found ${id}`);

        const recipient = mintEvents[0].args.recipient;
        const groupBtcAddress = mintEvents[0].args.groupBtcAddress;
        const mintBlock = mintEvents[0].blockNumber;
        const mintTimestamp = (await mintEvents[0].getBlock()).timestamp;
        console.log(
            `1. MintRequested\t=> ${formatTimestamp(
                mintTimestamp
            )} ${mintBlock}: recipient=${recipient} btcAddress=${groupBtcAddress} txid=${
                mintEvents[0].transactionHash
            }`
        );

        // 2. Find btc utxo
        const utxos = (await axios.get(getBtcUtxoUrl(btcNetwork, groupBtcAddress))).data;
        const utxo = findUtxo(utxos, mintTimestamp);
        if (utxo) {
            console.log(
                `2. BtcTransferred\t=> ${formatTimestamp(utxo.status.block_time)} ${
                    utxo.status.block_height
                }: txid=${utxo.status.block_hash}`
            );
        } else {
            console.log(`2. BtcTransferred\t=> Fail! utxos=${utxos}`);
        }

        if (!utxo) return;

        // 3. Keeper sign
        const depositSign = (await axios.get(getDepositSignUrl(network.name, id))).data;
        console.log("3. DepositSign  \t=>", depositSign);
        if (!depositSign.success) return;

        // 4. Verify mint
        const verifyEvents = await decusSystem.queryFilter(
            decusSystem.filters.MintVerified(id, null, null, null, null)
        );

        if (verifyEvents.length > 0) {
            const verifyBlock = verifyEvents[0].blockNumber;
            const event = verifyEvents[0];
            const verifyTimestamp = (await event.getBlock()).timestamp;
            console.log(
                `4. MintVerified \t=> ${formatTimestamp(verifyTimestamp)} ${verifyBlock}: btcTxId=${
                    event.args.btcTxId
                } btcTxHeight=${event.args.btcTxHeight} keepers=${event.args.keepers} txid=${
                    event.transactionHash
                }`
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

task("traceMVEvents", "get all MintVerified events").setAction(async (args, { ethers }) => {
    const decusSystem = (await ethers.getContract("DeCusSystem")) as DeCusSystem;
    const events = await decusSystem.queryFilter(
        decusSystem.filters.MintVerified(null, null, null, null, null)
    );
    console.log(`blocknumber,timestamp,receiptId,group,btcTxId,btcSender`);
    for (const event of events) {
        const blockNumber = event["blockNumber"];
        const timestamp = (await decusSystem.provider.getBlock(blockNumber)).timestamp;
        const receiptId = event["args"]["receiptId"];
        const group = event["args"]["groupBtcAddress"];
        const btcTxId = event["args"]["btcTxId"];
        const tx = await axios.get(`https://blockstream.info/testnet/api/tx/${btcTxId.slice(2)}`);
        const txVin = tx["data"]["vin"];
        let btcSender = txVin[0]["prevout"]["scriptpubkey_address"];
        if (txVin.length != 1) {
            for (let j = 1; j < txVin.length; j++) {
                btcSender += ` & ${txVin[j]["prevout"]["scriptpubkey_address"]}`;
            }
        }
        console.log(`${blockNumber},${timestamp},${receiptId},${group},${btcTxId},${btcSender}`);
    }
});
