import { expect } from "chai";
import { BigNumber, Wallet, constants } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
const { parseUnits, solidityKeccak256 } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
import { prepareSignature } from "./helper";
import { DeCusSystem, ERC20, KeeperRegistry } from "../build/typechain";

const KEEPER_SATOSHI = parseBtc("0.5"); // 50000000
const BTC_ADDRESS = [
    "38aNsdfsdfsdfsdfsdfdsfsdf0",
    "38aNsdfsdfsdfsdfsdfdsfsdf1",
    "38aNsdfsdfsdfsdfsdfdsfsdf2",
];

function getReceiptId(btcAddress: string, recipient: string, identifier: number): string {
    return solidityKeccak256(["string", "address", "uint256"], [btcAddress, recipient, identifier]);
}

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture();

    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer
    const wbtc = (await ethers.getContract("WBTC")) as ERC20;
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;
    const system = (await ethers.getContract("DeCusSystem")) as DeCusSystem;

    for (const user of users) {
        await wbtc.mint(user.address, parseBtc("100"));
        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await registry.connect(user).addKeeper(wbtc.address, KEEPER_SATOSHI);
    }

    return { deployer, users, system };
});

describe("DeCusSystem", function () {
    let users: Wallet[];
    let system: DeCusSystem;

    beforeEach(async function () {
        ({ users, system } = await setupFixture());
    });

    describe("getReceiptId()", function () {
        it("should get receipt ID", async function () {
            const btcAddress = BTC_ADDRESS[0];
            const identifier = 0;
            expect(await system.getReceiptId(btcAddress, users[0].address, identifier)).to.be.equal(
                getReceiptId(btcAddress, users[0].address, identifier)
            );
        });
    });

    describe("addGroup()", function () {
        it("should add group", async function () {
            await expect(
                system.addGroup(BTC_ADDRESS[0], 3, KEEPER_SATOSHI, [
                    users[0].address,
                    users[1].address,
                    users[2].address,
                    users[3].address,
                ])
            )
                .to.emit(system, "GroupAdded")
                .withArgs(BTC_ADDRESS[0], 3, KEEPER_SATOSHI, [
                    users[0].address,
                    users[1].address,
                    users[2].address,
                    users[3].address,
                ]);

            expect(await system.getGroup(BTC_ADDRESS[0])).deep.equal([
                BigNumber.from(3),
                BigNumber.from(KEEPER_SATOSHI),
                BigNumber.from(0),
            ]);
            expect(await system.getGroupAllowance(BTC_ADDRESS[0])).equal(
                BigNumber.from(KEEPER_SATOSHI)
            );
            expect(await system.listGroupKeeper(BTC_ADDRESS[0])).deep.equal([
                users[0].address,
                users[1].address,
                users[2].address,
                users[3].address,
            ]);
        });
    });

    describe("deleteGroup()", function () {
        beforeEach(async function () {
            await system.addGroup(BTC_ADDRESS[0], 3, KEEPER_SATOSHI, [
                users[0].address,
                users[1].address,
                users[2].address,
                users[3].address,
            ]);
        });

        it("delete not exist", async function () {
            await expect(system.deleteGroup(BTC_ADDRESS[1]))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS[1]);
        });

        it("should delete group", async function () {
            expect(await system.getGroup(BTC_ADDRESS[0])).deep.equal([
                BigNumber.from(3),
                BigNumber.from(KEEPER_SATOSHI),
                BigNumber.from(0),
            ]);
            expect(await system.listGroupKeeper(BTC_ADDRESS[0])).deep.equal([
                users[0].address,
                users[1].address,
                users[2].address,
                users[3].address,
            ]);

            await expect(system.deleteGroup(BTC_ADDRESS[0]))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS[0]);

            expect(await system.getGroup(BTC_ADDRESS[0])).deep.equal([
                BigNumber.from(0),
                BigNumber.from(0),
                BigNumber.from(0),
            ]);
            expect(await system.listGroupKeeper(BTC_ADDRESS[0])).deep.equal([]);
        });

        it("delete group twice", async function () {
            await expect(system.deleteGroup(BTC_ADDRESS[0]))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS[0]);

            await expect(system.deleteGroup(BTC_ADDRESS[0]))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS[0]);
        });

        it("add same address", async function () {
            await expect(system.deleteGroup(BTC_ADDRESS[0]))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS[0]);

            await system.addGroup(BTC_ADDRESS[0], 2, KEEPER_SATOSHI, [
                users[2].address,
                users[3].address,
            ]);
            expect(await system.getGroup(BTC_ADDRESS[0])).deep.equal([
                BigNumber.from(2),
                BigNumber.from(KEEPER_SATOSHI),
                BigNumber.from(0),
            ]);
        });
    });

    describe("requestMint()", function () {
        beforeEach(async function () {
            await system.addGroup(BTC_ADDRESS[0], 3, KEEPER_SATOSHI, [
                users[0].address,
                users[1].address,
                users[2].address,
                users[3].address,
            ]);
            await system.addGroup(BTC_ADDRESS[1], 3, KEEPER_SATOSHI, [
                users[0].address,
                users[1].address,
                users[4].address,
                users[5].address,
            ]);
        });

        it("should request mint", async function () {
            const btcAddress = BTC_ADDRESS[0];
            const amountInSatoshi = KEEPER_SATOSHI;
            const identifier = 0;
            const receiptId = getReceiptId(btcAddress, users[0].address, identifier);

            await expect(
                system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, identifier)
            )
                .to.emit(system, "MintRequested")
                .withArgs(BTC_ADDRESS[0], receiptId, users[0].address, amountInSatoshi);
        });
    });

    describe("verifyMint()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const identifier = 0;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;

        beforeEach(async function () {
            await system.addGroup(BTC_ADDRESS[0], 3, KEEPER_SATOSHI, [
                users[0].address,
                users[1].address,
                users[2].address,
                users[3].address,
            ]);
            await system.addGroup(BTC_ADDRESS[1], 3, KEEPER_SATOSHI, [
                users[0].address,
                users[1].address,
                users[4].address,
                users[5].address,
            ]);
            await system.connect(users[0]).requestMint(btcAddress, KEEPER_SATOSHI, identifier);
            receiptId = getReceiptId(btcAddress, users[0].address, identifier);
        });

        it("should verify mint", async function () {
            let receipt = await system.getReceipt(receiptId);
            let group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(1);
            expect(receipt.txId).to.be.equal(constants.HashZero);
            expect(receipt.height).to.be.equal(0);
            expect(group[2]).to.be.equal(0);

            const [rList, sList, packedV] = await prepareSignature(
                [users[1], users[2], users[3]],
                system.address,
                receiptId,
                txId,
                height
            );
            await expect(
                system
                    .connect(users[0])
                    .verifyMint(
                        { receiptId, txId, height },
                        [users[1].address, users[2].address, users[3].address],
                        rList,
                        sList,
                        packedV
                    )
            )
                .to.emit(system, "MintVerified")
                .withArgs(receiptId);

            receipt = await system.getReceipt(receiptId);
            group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(2);
            expect(receipt.txId).to.be.equal(txId);
            expect(receipt.height).to.be.equal(height);
            expect(group[2]).to.be.equal(KEEPER_SATOSHI);
        });
    });
});
