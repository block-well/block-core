import { HardhatRuntimeEnvironment } from "hardhat/types";
import { LedgerSigner } from "@ethersproject/hardware-wallets";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { task, types } from "hardhat/config";
import { KeeperRegistry, DeCusSystem, ERC20 } from "../build/typechain";
import { NonceManager } from "@ethersproject/experimental";
import { ethers, ContractTransaction } from "ethers";

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
    .addOptionalParam("asset", "WBTC or other BTC", "WBTC")
    .setAction(
        async ({ privKey, amount, asset }, { ethers }): Promise<ContractTransaction | null> => {
            const nonceManager = new NonceManager(new ethers.Wallet(privKey, ethers.provider));
            const keeper = await nonceManager.getAddress();

            const btc = (await ethers.getContract(asset, nonceManager)) as ERC20;
            const registry = (await ethers.getContract(
                "KeeperRegistry",
                nonceManager
            )) as KeeperRegistry;

            if ((await registry.getCollateralWei(keeper)).gt(0)) {
                console.log(`keeper exist: ${keeper}`);
                return null;
            }

            const num = ethers.utils.parseUnits(amount, await btc.decimals());
            const allowance = await btc.allowance(keeper, registry.address);
            if (allowance.lt(num)) {
                const tx = await btc.approve(registry.address, num);
                console.log(`${keeper} approve at ${tx.hash}`);
                // await tx.wait(nConfirmations);
                // console.log(`Waited for ${nConfirmations} confirmations`);
            }

            const keeperData = await registry.getKeeper(keeper);
            if (keeperData.amount < amount) {
                const tx = await registry.addKeeper(btc.address, num);
                console.log(`keeper added: ${keeper} tx ${tx.hash}`);
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

async function getLedgerSigner(hre: HardhatRuntimeEnvironment) {
    const deployerPath = process.env.HD_WALLET_PATH;
    console.log("deployer", deployerPath);

    const ledger = new LedgerSigner(hre.ethers.provider, "hid", deployerPath);

    const oldSignMessage = ledger.signMessage;
    ledger.signMessage = async function (message: ethers.utils.Bytes | string): Promise<string> {
        console.log("Please sign the following message on Ledger:", message);
        return await oldSignMessage.apply(this, [message]);
    };

    const oldSignTransaction = ledger.signTransaction;
    ledger.signTransaction = async function (
        transaction: ethers.providers.TransactionRequest
    ): Promise<string> {
        console.log("Please sign the following transaction on Ledger:", transaction);
        return await oldSignTransaction.apply(this, [transaction]);
    };

    const ledgerWithAddress = await SignerWithAddress.create(ledger);
    return [ledgerWithAddress];
}

task("accounts", "Prints the list of accounts", async (_args, hre) => {
    console.log('network', hre.network.name);
    const accounts =
        process.env.HD_WALLET_PATH && hre.network.name !== "hardhat"
            ? await getLedgerSigner(hre)
            : await hre.ethers.getSigners();
    for (const account of accounts) {
        console.log(account.address);
    }
});
