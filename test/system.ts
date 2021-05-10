import { expect } from "chai";
import { BigNumber, Wallet, constants } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
const { parseUnits, solidityKeccak256 } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
import { prepareSignature, advanceTimeAndBlock } from "./helper";
import { DeCusSystem, EBTC, ERC20, KeeperRegistry } from "../build/typechain";

const KEEPER_SATOSHI = parseBtc("0.5"); // 50000000
const GROUP_SATOSHI = parseBtc("0.6");
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
    const ebtc = (await ethers.getContract("EBTC")) as EBTC;

    for (const user of users) {
        await wbtc.mint(user.address, parseBtc("100"));
        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await registry.connect(user).addKeeper(wbtc.address, KEEPER_SATOSHI);
    }

    return { deployer, users, system, ebtc };
});

describe("DeCusSystem", function () {
    let users: Wallet[];
    let system: DeCusSystem;
    let ebtc: EBTC;

    beforeEach(async function () {
        ({ users, system, ebtc } = await setupFixture());
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
                system.addGroup(BTC_ADDRESS[0], 3, GROUP_SATOSHI, [
                    users[0].address,
                    users[1].address,
                    users[2].address,
                    users[3].address,
                ])
            )
                .to.emit(system, "GroupAdded")
                .withArgs(BTC_ADDRESS[0], 3, GROUP_SATOSHI, [
                    users[0].address,
                    users[1].address,
                    users[2].address,
                    users[3].address,
                ]);

            expect(await system.getGroup(BTC_ADDRESS[0])).deep.equal([
                BigNumber.from(3),
                BigNumber.from(GROUP_SATOSHI),
                BigNumber.from(0),
                ethers.constants.HashZero,
            ]);
            expect(await system.getGroupAllowance(BTC_ADDRESS[0])).equal(
                BigNumber.from(GROUP_SATOSHI)
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
            await system.addGroup(BTC_ADDRESS[0], 3, GROUP_SATOSHI, [
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
                BigNumber.from(GROUP_SATOSHI),
                BigNumber.from(0),
                ethers.constants.HashZero,
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
                ethers.constants.HashZero,
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

            await system.addGroup(BTC_ADDRESS[0], 2, GROUP_SATOSHI, [
                users[2].address,
                users[3].address,
            ]);
            expect(await system.getGroup(BTC_ADDRESS[0])).deep.equal([
                BigNumber.from(2),
                BigNumber.from(GROUP_SATOSHI),
                BigNumber.from(0),
                ethers.constants.HashZero,
            ]);
        });
    });

    const addMockGroup = async (): Promise<void> => {
        await system.addGroup(BTC_ADDRESS[0], 3, GROUP_SATOSHI, [
            users[0].address,
            users[1].address,
            users[2].address,
            users[3].address,
        ]);
        await system.addGroup(BTC_ADDRESS[1], 3, GROUP_SATOSHI, [
            users[0].address,
            users[1].address,
            users[4].address,
            users[5].address,
        ]);
    };

    const requestMint = async (
        user: Wallet,
        btcAddress: string,
        identifier: number
    ): Promise<string> => {
        await system.connect(user).requestMint(btcAddress, GROUP_SATOSHI, identifier);
        return getReceiptId(btcAddress, user.address, identifier);
    };

    const verifyMint = async (
        user: Wallet,
        keepers: Wallet[],
        receiptId: string,
        txId: string,
        height: number
    ): Promise<void> => {
        const [rList, sList, packedV] = await prepareSignature(
            keepers,
            system.address,
            receiptId,
            txId,
            height
        );

        const keeperAddresses = keepers.map((x) => x.address);
        await system
            .connect(user)
            .verifyMint({ receiptId, txId, height }, keeperAddresses, rList, sList, packedV);
    };

    describe("requestMint()", function () {
        beforeEach(async function () {
            await addMockGroup();
        });

        it("should request mint", async function () {
            const btcAddress = BTC_ADDRESS[0];
            const amountInSatoshi = GROUP_SATOSHI;
            const identifier = 0;
            const receiptId = getReceiptId(btcAddress, users[0].address, identifier);

            // working receipt
            expect((await system.getGroup(btcAddress))[3]).to.equal(ethers.constants.HashZero);

            await expect(
                system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, identifier)
            )
                .to.emit(system, "MintRequested")
                .withArgs(receiptId, BTC_ADDRESS[0], users[0].address, amountInSatoshi);

            expect((await system.getGroup(btcAddress))[3]).to.equal(receiptId);
        });

        it("revoke mint", async function () {
            const btcAddress = BTC_ADDRESS[0];
            const amountInSatoshi = GROUP_SATOSHI;
            const identifier = 0;
            const receiptId = getReceiptId(btcAddress, users[0].address, identifier);

            expect((await system.getGroup(btcAddress))[3]).to.equal(ethers.constants.HashZero);

            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, identifier);

            expect((await system.getGroup(btcAddress))[3]).to.equal(receiptId);

            await expect(system.connect(users[1]).revokeMint(receiptId)).to.revertedWith(
                "require receipt recipient"
            );

            await expect(system.connect(users[0]).revokeMint(receiptId))
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, users[0].address);

            expect((await system.getGroup(btcAddress))[3]).to.equal(ethers.constants.HashZero);
        });

        // TODO: force mint request
        it("force mint request", async function () {
            const btcAddress = BTC_ADDRESS[0];
            const amountInSatoshi = GROUP_SATOSHI;
            const identifier = 0;
            const receiptId = getReceiptId(btcAddress, users[0].address, identifier);

            expect((await system.getGroup(btcAddress))[3]).to.equal(ethers.constants.HashZero);

            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, identifier);

            expect((await system.getGroup(btcAddress))[3]).to.equal(receiptId);

            const identifier2 = identifier + 1;
            await expect(
                system.connect(users[1]).forceRequestMint(btcAddress, GROUP_SATOSHI, identifier2)
            ).to.revertedWith("deposit in progress");

            advanceTimeAndBlock(24 * 3600);

            const receiptId2 = getReceiptId(btcAddress, users[1].address, identifier2);
            await expect(
                system.connect(users[1]).forceRequestMint(btcAddress, GROUP_SATOSHI, identifier2)
            )
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, users[1].address)
                .to.emit(system, "MintRequested")
                .withArgs(receiptId2, btcAddress, users[1].address, GROUP_SATOSHI);
        });
    });

    describe("verifyMint()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const identifier = 0;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;

        beforeEach(async function () {
            await addMockGroup();

            receiptId = await requestMint(users[0], btcAddress, identifier);
        });

        it("should verify mint", async function () {
            let receipt = await system.getReceipt(receiptId);
            let group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(1);
            expect(receipt.txId).to.be.equal(constants.HashZero);
            expect(receipt.height).to.be.equal(0);
            expect(group[2]).to.be.equal(0);

            const keepers = [users[1], users[2], users[3]];
            const [rList, sList, packedV] = await prepareSignature(
                keepers,
                system.address,
                receiptId,
                txId,
                height
            );

            const keeperAddresses = keepers.map((x) => x.address);
            await expect(
                system
                    .connect(users[0])
                    .verifyMint({ receiptId, txId, height }, keeperAddresses, rList, sList, packedV)
            )
                .to.emit(system, "MintVerified")
                .withArgs(receiptId, keeperAddresses);

            receipt = await system.getReceipt(receiptId);
            group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(2);
            expect(receipt.txId).to.be.equal(txId);
            expect(receipt.height).to.be.equal(height);
            expect(group[2]).to.be.equal(GROUP_SATOSHI);
            expect(group[3]).to.be.equal(ethers.constants.HashZero);

            expect(await ebtc.balanceOf(users[0].address)).to.be.equal(GROUP_SATOSHI.mul(10 ** 10));
        });
    });

    describe("requestBurn()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const withdrawBtcAddress = BTC_ADDRESS[1];
        const identifier = 0;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const userEbtcAmount = GROUP_SATOSHI.mul(10 ** 10);

        beforeEach(async function () {
            await addMockGroup();

            receiptId = await requestMint(users[0], btcAddress, identifier);

            await verifyMint(users[0], [users[1], users[2], users[3]], receiptId, txId, height);
        });

        it("request burn", async function () {
            await ebtc.connect(users[0]).approve(system.address, userEbtcAmount);
            await expect(system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress))
                .to.emit(system, "BurnRequested")
                .withArgs(receiptId, withdrawBtcAddress, users[0].address);

            const receipt = await system.getReceipt(receiptId);
            expect(receipt.status).to.be.equal(3);
            expect(receipt.withdrawBtcAddress).to.be.equal(withdrawBtcAddress);
            expect(await ebtc.balanceOf(users[0].address)).to.be.equal(0);
            expect(await ebtc.balanceOf(system.address)).to.be.equal(userEbtcAmount);
        });
    });

    describe("verifyBurn()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const withdrawBtcAddress = BTC_ADDRESS[1];
        const identifier = 0;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const userEbtcAmount = GROUP_SATOSHI.mul(10 ** 10);

        beforeEach(async function () {
            await addMockGroup();

            receiptId = await requestMint(users[0], btcAddress, identifier);

            await verifyMint(users[0], [users[1], users[2], users[3]], receiptId, txId, height);

            await ebtc.connect(users[0]).approve(system.address, userEbtcAmount);
            await system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress);
        });

        it("verify burn", async function () {
            await expect(system.connect(users[0]).verifyBurn(receiptId))
                .to.emit(system, "BurnVerified")
                .withArgs(receiptId, users[0].address);

            const receipt = await system.getReceipt(receiptId);
            expect(receipt.status).to.be.equal(0);
            expect(await ebtc.balanceOf(users[0].address)).to.be.equal(0);
            expect(await ebtc.balanceOf(system.address)).to.be.equal(0);
        });

        it("mint without verify burn", async function () {
            advanceTimeAndBlock(24 * 60 * 60);

            const identifier2 = identifier + 1;
            await expect(
                system.connect(users[1]).requestMint(btcAddress, GROUP_SATOSHI, identifier2)
            ).to.be.revertedWith("working receipt in progress");

            const receiptId2 = getReceiptId(btcAddress, users[1].address, identifier2);
            await expect(
                system.connect(users[1]).forceRequestMint(btcAddress, GROUP_SATOSHI, identifier2)
            )
                .to.emit(system, "BurnVerified")
                .withArgs(receiptId, users[1].address)
                .to.emit(system, "MintRequested")
                .withArgs(receiptId2, btcAddress, users[1].address, GROUP_SATOSHI);

            const group = await system.getGroup(btcAddress);
            expect(group[2]).to.be.equal(0);
            expect(group[3]).to.be.equal(receiptId2);
            const receipt = await system.getReceipt(receiptId2);
            expect(receipt.status).to.be.equal(1);
        });
    });
});
