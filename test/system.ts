import { expect } from "chai";
import { BigNumber, Contract, Wallet, constants } from "ethers";
import { MockContract, MockProvider } from "ethereum-waffle";
import { waffle, ethers } from "hardhat";
const { loadFixture } = waffle;
const { /*parseEther,*/ parseUnits, solidityKeccak256 } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
import { deployMockForName } from "./mock";
import { prepareSignature } from "./helper";

const BTC_ADDRESS_0 = "38aNsdfsdfsdfsdfsdfdsfsdf0";
const BTC_ADDRESS_1 = "38aNsdfsdfsdfsdfsdfdsfsdf1";
// const BTC_ADDRESS_2 = "38aNsdfsdfsdfsdfsdfdsfsdf2";
const KEEPER_SATOSHI = parseBtc("0.5"); // 50000000

function getReceiptId(btcAddress: string, recipient: string, identifier: number): string {
    return solidityKeccak256(["string", "address", "uint256"], [btcAddress, recipient, identifier]);
}

describe("DeCusSystem", function () {
    interface FixtureWalletMap {
        readonly [name: string]: Wallet;
    }

    interface FixtureData {
        readonly wallets: FixtureWalletMap;
        readonly ebtc: MockContract;
        readonly system: Contract;
    }

    let fixtureData: FixtureData;

    let user1: Wallet;
    let user2: Wallet;
    let user3: Wallet;
    let user4: Wallet;
    let user5: Wallet;
    let user6: Wallet;
    // let owner: Wallet;
    // let ebtc: MockContract;
    let system: Contract;

    async function deployFixture(_wallets: Wallet[], provider: MockProvider): Promise<FixtureData> {
        const [user1, user2, user3, user4, user5, user6, owner] = provider.getWallets();

        const DeCusSystem = await ethers.getContractFactory("DeCusSystem");
        const system = await DeCusSystem.connect(owner).deploy();

        const ebtc = await deployMockForName(owner, "IEBTC");
        await ebtc.mock.mint.returns(); // 0.1% per day

        const registry = await deployMockForName(owner, "IKeeperRegistry");
        await registry.mock.getCollateralValue.returns(parseBtc("0.5")); // 0.1% per day

        await system.initialize(ebtc.address, registry.address);

        return {
            wallets: { user1, user2, user3, user4, user5, user6, owner },
            ebtc,
            system,
        };
    }

    beforeEach(async function () {
        fixtureData = await loadFixture(deployFixture);
        user1 = fixtureData.wallets.user1;
        user2 = fixtureData.wallets.user2;
        user3 = fixtureData.wallets.user3;
        user4 = fixtureData.wallets.user4;
        user5 = fixtureData.wallets.user5;
        user6 = fixtureData.wallets.user6;
        // owner = fixtureData.wallets.owner;
        // ebtc = fixtureData.ebtc;
        system = fixtureData.system;
    });

    describe("getReceiptId()", function () {
        it("should get receipt ID", async function () {
            const btcAddress = BTC_ADDRESS_0;
            const identifier = 0;
            expect(await system.getReceiptId(btcAddress, user1.address, identifier)).to.be.equal(
                getReceiptId(btcAddress, user1.address, identifier)
            );
        });
    });

    describe("addGroup()", function () {
        it("should add group", async function () {
            await expect(
                system.addGroup(BTC_ADDRESS_0, 3, KEEPER_SATOSHI, [
                    user1.address,
                    user2.address,
                    user3.address,
                    user4.address,
                ])
            )
                .to.emit(system, "GroupAdded")
                .withArgs(BTC_ADDRESS_0, 3, KEEPER_SATOSHI, [
                    user1.address,
                    user2.address,
                    user3.address,
                    user4.address,
                ]);

            expect(await system.getGroup(BTC_ADDRESS_0)).deep.equal([
                BigNumber.from(3),
                BigNumber.from(KEEPER_SATOSHI),
                BigNumber.from(0),
            ]);
            expect(await system.getGroupAllowance(BTC_ADDRESS_0)).equal(
                BigNumber.from(KEEPER_SATOSHI)
            );
            expect(await system.listGroupKeeper(BTC_ADDRESS_0)).deep.equal([
                user1.address,
                user2.address,
                user3.address,
                user4.address,
            ]);
        });
    });

    describe("deleteGroup()", function () {
        beforeEach(async function () {
            await system.addGroup(BTC_ADDRESS_0, 3, KEEPER_SATOSHI, [
                user1.address,
                user2.address,
                user3.address,
                user4.address,
            ]);
        });

        it("delete not exist", async function () {
            await expect(system.deleteGroup(BTC_ADDRESS_1))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS_1);
        });

        it("should delete group", async function () {
            expect(await system.getGroup(BTC_ADDRESS_0)).deep.equal([
                BigNumber.from(3),
                BigNumber.from(KEEPER_SATOSHI),
                BigNumber.from(0),
            ]);
            expect(await system.listGroupKeeper(BTC_ADDRESS_0)).deep.equal([
                user1.address,
                user2.address,
                user3.address,
                user4.address,
            ]);

            await expect(system.deleteGroup(BTC_ADDRESS_0))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS_0);

            expect(await system.getGroup(BTC_ADDRESS_0)).deep.equal([
                BigNumber.from(0),
                BigNumber.from(0),
                BigNumber.from(0),
            ]);
            expect(await system.listGroupKeeper(BTC_ADDRESS_0)).deep.equal([]);
        });

        it("delete group twice", async function () {
            await expect(system.deleteGroup(BTC_ADDRESS_0))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS_0);

            await expect(system.deleteGroup(BTC_ADDRESS_0))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS_0);
        });

        it("add same address", async function () {
            await expect(system.deleteGroup(BTC_ADDRESS_0))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS_0);

            await system.addGroup(BTC_ADDRESS_0, 2, KEEPER_SATOSHI, [user3.address, user4.address]);
            expect(await system.getGroup(BTC_ADDRESS_0)).deep.equal([
                BigNumber.from(2),
                BigNumber.from(KEEPER_SATOSHI),
                BigNumber.from(0),
            ]);
        });
    });

    describe("requestMint()", function () {
        beforeEach(async function () {
            await system.addGroup(BTC_ADDRESS_0, 3, KEEPER_SATOSHI, [
                user1.address,
                user2.address,
                user3.address,
                user4.address,
            ]);
            await system.addGroup(BTC_ADDRESS_1, 3, KEEPER_SATOSHI, [
                user1.address,
                user2.address,
                user5.address,
                user6.address,
            ]);
        });

        it("should request mint", async function () {
            const btcAddress = BTC_ADDRESS_0;
            const amountInSatoshi = KEEPER_SATOSHI;
            const identifier = 0;
            const receiptId = getReceiptId(btcAddress, user1.address, identifier);

            await expect(system.connect(user1).requestMint(btcAddress, amountInSatoshi, identifier))
                .to.emit(system, "MintRequested")
                .withArgs(BTC_ADDRESS_0, receiptId, user1.address, amountInSatoshi);
        });
    });

    describe("verifyMint()", function () {
        const btcAddress = BTC_ADDRESS_0;
        const identifier = 0;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;

        beforeEach(async function () {
            await system.addGroup(BTC_ADDRESS_0, 3, KEEPER_SATOSHI, [
                user1.address,
                user2.address,
                user3.address,
                user4.address,
            ]);
            await system.addGroup(BTC_ADDRESS_1, 3, KEEPER_SATOSHI, [
                user1.address,
                user2.address,
                user5.address,
                user6.address,
            ]);
            await system.connect(user1).requestMint(btcAddress, KEEPER_SATOSHI, identifier);
            receiptId = getReceiptId(btcAddress, user1.address, identifier);
        });

        it("should verify mint", async function () {
            let receipt = await system.getReceipt(receiptId);
            let group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(1);
            expect(receipt.txId).to.be.equal(constants.HashZero);
            expect(receipt.height).to.be.equal(0);
            expect(group[2]).to.be.equal(0);

            const [rList, sList, packedV] = await prepareSignature(
                [user2, user3, user4],
                system.address,
                receiptId,
                txId,
                height
            );
            await expect(
                system
                    .connect(user1)
                    .verifyMint(
                        [receiptId, txId, height],
                        [user2.address, user3.address, user4.address],
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
