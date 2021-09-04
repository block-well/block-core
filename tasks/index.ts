import { task, types } from "hardhat/config";
import { KeeperRegistry, DeCusSystem, ERC20 } from "../build/typechain";
import { NonceManager } from "@ethersproject/experimental";
import { ContractTransaction } from "ethers";

const nConfirmations = 6;

export const waitForConfirmations = async (
    transactions: ContractTransaction[],
    confirmations: number
): Promise<void> => {
    console.log(`==>\nWaiting for ${confirmations} confirmations`);
    const startTime = new Date().getTime();
    const receipts = await Promise.all(transactions.map(async (x) => x.wait(confirmations)));
    const elapseTime = Math.round((new Date().getTime() - startTime) / 1000);
    console.log(`${nConfirmations} confirmations finished in ${elapseTime} seconds`);
    for (const r of receipts) {
        console.log(`\t${r.transactionHash} confirmed @${r.blockNumber} gasUsed ${r.gasUsed}`);
    }
    console.log(`<==`);
};

task("addKeeper", "add keeper")
    .addParam("privKey", "Keeper private key")
    .addParam("amount", "Keeper collateral amount in BTC", "0.01", types.string)
    .addOptionalParam("asset", "WBTC or BTCB", "BTC")
    .setAction(
        async ({ privKey, amount, asset }, { ethers }): Promise<ContractTransaction | null> => {
            const keeper = new ethers.Wallet(privKey, ethers.provider);
            const nonceManager = new NonceManager(keeper);

            const btc = (await ethers.getContract(asset, nonceManager)) as ERC20;
            const registry = (await ethers.getContract(
                "KeeperRegistry",
                nonceManager
            )) as KeeperRegistry;

            console.log(`keeper ${keeper.address} btc ${btc.address} registry ${registry.address}`);

            if ((await registry.getCollateralWei(keeper.address)).gt(0)) {
                console.log(`keeper exist: ${keeper.address}`);
                return null;
            }

            const num = ethers.utils.parseUnits(amount, await btc.decimals());
            const allowance = await btc.allowance(keeper.address, registry.address);
            if (allowance.lt(num)) {
                const tx = await btc.connect(keeper).approve(registry.address, num);
                console.log(`${keeper.address} approve at ${tx.hash}`);
                // await tx.wait(nConfirmations);
                // console.log(`Waited for ${nConfirmations} confirmations`);
            }

            const keeperData = await registry.getKeeper(keeper.address);
            if (keeperData.amount < amount) {
                const tx = await registry.connect(keeper).addKeeper(btc.address, num);
                console.log(`keeper added: ${keeper.address} tx ${tx.hash}`);
                return tx;
            }
            return null;
        }
    );

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
        if (group.required === 0) {
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
