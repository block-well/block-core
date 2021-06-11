import { expect } from "chai";
import { BigNumber, Wallet, constants } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
const { parseUnits, parseEther } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
import {
    prepareSignature,
    advanceTimeAndBlock,
    currentTime,
    getReceiptId,
    GroupStatus,
    Status,
} from "./helper";
import { DeCusSystem, CONG, ERC20, KeeperRegistry, Fee } from "../build/typechain";

const SATOSHI_CONG_MULTIPLIER = BigNumber.from(10).pow(10);
const KEEPER_SATOSHI = parseBtc("0.5"); // 50000000
const GROUP_SATOSHI = parseBtc("0.6");
const BTC_ADDRESS = [
    "38aNsdfsdfsdfsdfsdfdsfsdf0",
    "38aNsdfsdfsdfsdfsdfdsfsdf1",
    "38aNsdfsdfsdfsdfsdfdsfsdf2",
];

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture();

    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer
    const wbtc = (await ethers.getContract("WBTC")) as ERC20;
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;
    const system = (await ethers.getContract("DeCusSystem")) as DeCusSystem;
    const cong = (await ethers.getContract("CONG")) as CONG;
    const fee = (await ethers.getContract("Fee")) as Fee;

    for (const user of users) {
        await wbtc.mint(user.address, parseBtc("100"));
        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await registry.connect(user).addKeeper(wbtc.address, KEEPER_SATOSHI);
    }

    return { deployer, users, system, cong, fee };
});

describe("DeCusSystem", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let system: DeCusSystem;
    let cong: CONG;
    let fee: Fee;
    let group1Keepers: Wallet[];
    let group2Keepers: Wallet[];
    let group1Verifiers: Wallet[];
    let group2Verifiers: Wallet[];

    beforeEach(async function () {
        ({ deployer, users, system, cong, fee } = await setupFixture());
        group1Keepers = [users[0], users[1], users[2], users[3]];
        group2Keepers = [users[0], users[1], users[4], users[5]];

        group1Verifiers = group1Keepers.slice(1);
        group2Verifiers = group2Keepers.slice(1);
    });

    describe("constant", function () {
        it("constant", async function () {
            expect(await cong.BTC_MULTIPLIER()).to.be.equal(1e8);
        });
    });

    describe("getReceiptId()", function () {
        it("should get receipt ID", async function () {
            const btcAddress = BTC_ADDRESS[0];
            const nonce = 1;
            expect(await system.getReceiptId(btcAddress, nonce)).to.be.equal(
                getReceiptId(btcAddress, nonce)
            );
        });
    });

    describe("addGroup()", function () {
        it("update minKeeperWei", async function () {
            expect(await system.minKeeperWei()).to.be.gt(parseEther("0.000001"));
            const minKeeperWei = parseEther("1");
            expect(await system.minKeeperWei()).to.be.lt(minKeeperWei);

            await expect(system.connect(deployer).updateMinKeeperWei(minKeeperWei))
                .to.emit(system, "MinKeeperWeiUpdated")
                .withArgs(minKeeperWei);

            const keepers = group1Keepers.map((x) => x.address);
            await expect(
                system.addGroup(BTC_ADDRESS[0], 3, GROUP_SATOSHI, keepers)
            ).to.revertedWith("keeper has not enough collateral");
        });

        it("should add group", async function () {
            const keepers = group1Keepers.map((x) => x.address);
            await expect(system.addGroup(BTC_ADDRESS[0], 3, GROUP_SATOSHI, keepers))
                .to.emit(system, "GroupAdded")
                .withArgs(BTC_ADDRESS[0], 3, GROUP_SATOSHI, keepers);

            const group = await system.getGroup(BTC_ADDRESS[0]);
            expect(group.required).equal(BigNumber.from(3));
            expect(group.maxSatoshi).equal(BigNumber.from(GROUP_SATOSHI));
            expect(group.currSatoshi).equal(BigNumber.from(0));
            expect(group.nonce).equal(BigNumber.from(0));
            expect(group.status).equal(GroupStatus.Available);
            expect(group.keepers).deep.equal(keepers);
            expect(group.workingReceiptId).equal(
                await system.getReceiptId(BTC_ADDRESS[0], group.nonce)
            );
        });
    });

    describe("deleteGroup()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const withdrawBtcAddress = BTC_ADDRESS[1];
        const amountInSatoshi = GROUP_SATOSHI;
        const userCongAmount = amountInSatoshi.mul(10 ** 10);
        const nonce = 1;
        const receiptId = getReceiptId(btcAddress, nonce);
        let keepers: string[];
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;

        beforeEach(async function () {
            keepers = group1Keepers.map((x) => x.address);

            await system.addGroup(btcAddress, 3, amountInSatoshi, keepers);
        });

        it("delete not exist", async function () {
            await expect(system.deleteGroup(BTC_ADDRESS[1]))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS[1]);
        });

        it("should delete group", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.required).equal(BigNumber.from(3));
            expect(group.maxSatoshi).equal(BigNumber.from(amountInSatoshi));
            expect(group.currSatoshi).equal(BigNumber.from(0));
            expect(group.nonce).equal(BigNumber.from(0));
            expect(group.status).equal(GroupStatus.Available);
            expect(group.keepers).deep.equal(keepers);
            expect(group.workingReceiptId).equal(
                await system.getReceiptId(btcAddress, group.nonce)
            );

            await expect(system.deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);

            group = await system.getGroup(btcAddress);
            expect(group.required).equal(BigNumber.from(0));
            expect(group.maxSatoshi).equal(BigNumber.from(0));
            expect(group.currSatoshi).equal(BigNumber.from(0));
            expect(group.nonce).equal(BigNumber.from(0));
            expect(group.status).equal(GroupStatus.None);
            expect(group.keepers).deep.equal([]);
            expect(group.workingReceiptId).equal(await system.getReceiptId(btcAddress, 0));
        });

        it("delete group twice", async function () {
            await expect(system.deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);

            await expect(system.deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);
        });

        it("add same address", async function () {
            await expect(system.deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);

            await system.addGroup(btcAddress, 2, amountInSatoshi, [
                users[2].address,
                users[3].address,
            ]);
            const group = await system.getGroup(btcAddress);
            expect(group.required).equal(BigNumber.from(2)); // new group `required`
        });

        it("delete group when deposit in progress", async function () {
            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce);

            await expect(system.connect(deployer).deleteGroup(btcAddress)).to.revertedWith(
                "deposit in progress"
            );
        });

        it("delete group when mint timeout", async function () {
            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce);

            await advanceTimeAndBlock(24 * 3600);

            await expect(system.connect(deployer).deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);
        });

        it("delete group when mint revoked", async function () {
            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce);

            await system.connect(users[0]).revokeMint(receiptId);

            await expect(system.connect(deployer).deleteGroup(btcAddress)).to.revertedWith(
                "receipt in resuing gap"
            );

            await advanceTimeAndBlock(3600);

            await expect(system.connect(deployer).deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);
        });

        it("delete group when mint verified", async function () {
            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce);

            const [rList, sList, packedV] = await prepareSignature(
                group1Verifiers,
                system.address,
                receiptId,
                txId,
                height
            );

            const keeperAddresses = group1Verifiers.map((x) => x.address);
            await system
                .connect(users[0])
                .verifyMint({ receiptId, txId, height }, keeperAddresses, rList, sList, packedV);

            await expect(system.connect(deployer).deleteGroup(btcAddress)).to.revertedWith(
                "group balance > 0"
            );
        });

        it("delete group when burn requested", async function () {
            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce);
            const [rList, sList, packedV] = await prepareSignature(
                group1Verifiers,
                system.address,
                receiptId,
                txId,
                height
            );
            const keeperAddresses = group1Verifiers.map((x) => x.address);
            await system
                .connect(users[0])
                .verifyMint({ receiptId, txId, height }, keeperAddresses, rList, sList, packedV);
            await cong.connect(users[0]).approve(system.address, userCongAmount);
            await system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress);

            await expect(system.connect(deployer).deleteGroup(btcAddress)).to.revertedWith(
                "withdraw in progress"
            );

            await advanceTimeAndBlock(48 * 3600);

            await expect(system.connect(deployer).deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);
        });

        it("delete group when burn verified", async function () {
            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce);
            const [rList, sList, packedV] = await prepareSignature(
                group1Verifiers,
                system.address,
                receiptId,
                txId,
                height
            );

            const keeperAddresses = group1Verifiers.map((x) => x.address);
            await system
                .connect(users[0])
                .verifyMint({ receiptId, txId, height }, keeperAddresses, rList, sList, packedV);
            await cong.connect(users[0]).approve(system.address, userCongAmount);
            await system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress);
            await system.connect(users[0]).verifyBurn(receiptId);

            await expect(system.connect(deployer).deleteGroup(btcAddress)).to.revertedWith(
                "receipt in resuing gap"
            );

            await advanceTimeAndBlock(3600);

            await expect(system.connect(deployer).deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);
        });
    });

    const addMockGroup = async (): Promise<void> => {
        await system.addGroup(
            BTC_ADDRESS[0],
            3,
            GROUP_SATOSHI,
            group1Keepers.map((x) => x.address)
        );
        await system.addGroup(
            BTC_ADDRESS[1],
            3,
            GROUP_SATOSHI,
            group2Keepers.map((x) => x.address)
        );
    };

    const requestMint = async (
        user: Wallet,
        btcAddress: string,
        nonce: number
    ): Promise<string> => {
        await system.connect(user).requestMint(btcAddress, GROUP_SATOSHI, nonce);
        return getReceiptId(btcAddress, nonce);
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
        const btcAddress = BTC_ADDRESS[0];
        const amountInSatoshi = GROUP_SATOSHI;
        const nonce = 1;
        const receiptId = getReceiptId(btcAddress, nonce);

        beforeEach(async function () {
            await addMockGroup();
        });

        it("invalid nonce", async function () {
            await expect(
                system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce + 1)
            ).to.revertedWith("invalid nonce");
        });

        it("should request mint", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce - 1);
            expect(group.status).equal(GroupStatus.Available);

            await expect(system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce))
                .to.emit(system, "MintRequested")
                .withArgs(receiptId, users[0].address, amountInSatoshi, BTC_ADDRESS[0]);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);
            expect(group.status).equal(GroupStatus.MintRequested);
        });

        it("revoke mint", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce - 1);
            expect(group.status).equal(GroupStatus.Available);
            expect((await system.getGroup(btcAddress))[3]).to.equal(nonce - 1);

            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);
            expect(group.status).equal(GroupStatus.MintRequested);
            expect((await system.getReceipt(receiptId)).status).to.equal(1);

            await expect(system.connect(users[1]).revokeMint(receiptId)).to.revertedWith(
                "require receipt recipient"
            );

            await expect(system.connect(users[0]).revokeMint(receiptId))
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, btcAddress, users[0].address);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);
            expect(group.status).equal(GroupStatus.MintGap);
            expect((await system.getReceipt(receiptId)).status).to.equal(0);
        });

        it("force mint request", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce - 1);

            await system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);
            expect(group.status).equal(GroupStatus.MintRequested);

            const nonce2 = nonce + 1;
            await expect(
                system.connect(users[1]).forceRequestMint(btcAddress, GROUP_SATOSHI, nonce2)
            ).to.revertedWith("deposit in progress");

            await advanceTimeAndBlock(24 * 3600);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);
            expect(group.status).equal(GroupStatus.MintTimeout);

            const receiptId2 = getReceiptId(btcAddress, nonce2);
            await expect(
                system.connect(users[1]).forceRequestMint(btcAddress, GROUP_SATOSHI, nonce2)
            )
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, btcAddress, users[1].address)
                .to.emit(system, "MintRequested")
                .withArgs(receiptId2, users[1].address, GROUP_SATOSHI, btcAddress);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce + 1);
            expect(group.status).equal(GroupStatus.MintRequested);

            const statusArray = await system.listGroupStatus(BTC_ADDRESS);
            expect(statusArray).deep.equal([
                GroupStatus.MintRequested,
                GroupStatus.Available,
                GroupStatus.None,
            ]);
        });
    });

    describe("verifyMint()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const nonce = 1;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const groupCongAmount = GROUP_SATOSHI.mul(SATOSHI_CONG_MULTIPLIER);

        beforeEach(async function () {
            await addMockGroup();

            receiptId = await requestMint(users[0], btcAddress, nonce);
        });

        it("should verify mint", async function () {
            let receipt = await system.getReceipt(receiptId);
            let group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(Status.DepositRequested);
            expect(receipt.txId).to.be.equal(constants.HashZero);
            expect(receipt.height).to.be.equal(0);
            expect(group[2]).to.be.equal(0);
            expect(group[3]).to.be.equal(nonce);
            expect(group.status).equal(GroupStatus.MintRequested);
            expect(group.cooldown).equal(BigNumber.from(group.keepers.length));

            const keepers = group1Verifiers;
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
                .withArgs(receiptId, btcAddress, keeperAddresses);

            receipt = await system.getReceipt(receiptId);
            group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(Status.DepositReceived);
            expect(receipt.txId).to.be.equal(txId);
            expect(receipt.height).to.be.equal(height);
            expect(group[2]).to.be.equal(GROUP_SATOSHI);
            expect(group[3]).to.be.equal(nonce);
            expect(group.status).equal(GroupStatus.MintVerified);
            expect(group.cooldown).equal(
                BigNumber.from(group.keepers.length - keeperAddresses.length)
            );

            expect(await cong.balanceOf(users[0].address)).to.be.equal(groupCongAmount);
        });

        it("verify mint repeated keeper", async function () {
            const verifier = [group1Verifiers[0], group1Verifiers[1], group1Verifiers[1]];

            const keepers = verifier;
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
            ).to.revertedWith("keeper is in cooldown");
        });

        it("verify mint timeout", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.MintRequested);

            await advanceTimeAndBlock(24 * 3600); // > MINT_REQUEST_GRACE_PERIOD

            group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.MintTimeout);

            const keepers = group1Verifiers;
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
                .withArgs(receiptId, btcAddress, keeperAddresses);

            group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.MintVerified);
        });

        it("forbit verify for outdated receipt", async function () {
            await advanceTimeAndBlock(24 * 3600);

            const nonce2 = nonce + 1;
            const receiptId2 = getReceiptId(btcAddress, nonce2);
            await expect(
                system.connect(users[1]).forceRequestMint(btcAddress, GROUP_SATOSHI, nonce2)
            )
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, btcAddress, users[1].address)
                .to.emit(system, "MintRequested")
                .withArgs(receiptId2, users[1].address, GROUP_SATOSHI, btcAddress);

            const keepers = group1Verifiers;
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
            ).to.revertedWith("keeper is not in group");
        });

        it("forbit verify for cancelled", async function () {
            await expect(system.connect(users[0]).revokeMint(receiptId))
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, btcAddress, users[0].address);

            const keepers = group1Verifiers;
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
            ).to.revertedWith("receipt is not in DepositRequested state");
        });
    });

    describe("requestBurn()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const withdrawBtcAddress = BTC_ADDRESS[1];
        const nonce = 1;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const userCongAmount = GROUP_SATOSHI.mul(SATOSHI_CONG_MULTIPLIER);

        beforeEach(async function () {
            await addMockGroup();

            receiptId = await requestMint(users[0], btcAddress, nonce);

            await verifyMint(users[0], group1Verifiers, receiptId, txId, height);
        });

        it("request burn", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.MintVerified);

            await cong.connect(users[0]).approve(system.address, userCongAmount);
            await expect(system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress))
                .to.emit(system, "BurnRequested")
                .withArgs(receiptId, btcAddress, withdrawBtcAddress, users[0].address);

            group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.BurnRequested);

            const receipt = await system.getReceipt(receiptId);
            expect(receipt.status).to.be.equal(3);
            expect(receipt.withdrawBtcAddress).to.be.equal(withdrawBtcAddress);
            expect(await cong.balanceOf(users[0].address)).to.be.equal(0);
            expect(await cong.balanceOf(system.address)).to.be.equal(userCongAmount);
        });
    });

    describe("verifyBurn()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const withdrawBtcAddress = BTC_ADDRESS[1];
        const nonce = 1;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const userCongAmount = GROUP_SATOSHI.mul(SATOSHI_CONG_MULTIPLIER);

        beforeEach(async function () {
            await addMockGroup();

            receiptId = await requestMint(users[0], btcAddress, nonce);

            await verifyMint(users[0], group1Verifiers, receiptId, txId, height);

            await cong.connect(users[0]).approve(system.address, userCongAmount);
            await system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress);
        });

        it("verify burn", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.BurnRequested);

            await expect(system.connect(users[0]).verifyBurn(receiptId))
                .to.emit(system, "BurnVerified")
                .withArgs(receiptId, btcAddress, users[0].address);

            group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.MintGap);

            const receipt = await system.getReceipt(receiptId);
            expect(receipt.status).to.be.equal(0);
            expect(await cong.balanceOf(users[0].address)).to.be.equal(0);
            expect(await cong.balanceOf(system.address)).to.be.equal(0);

            const nonce2 = nonce + 1;
            const receiptId2 = getReceiptId(btcAddress, nonce2);

            await expect(
                system.connect(users[1]).requestMint(btcAddress, GROUP_SATOSHI, nonce2)
            ).to.revertedWith("group cooling down");

            await advanceTimeAndBlock(3600);

            group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.Available);

            await expect(system.connect(users[1]).requestMint(btcAddress, GROUP_SATOSHI, nonce2))
                .to.emit(system, "MintRequested")
                .withArgs(receiptId2, users[1].address, GROUP_SATOSHI, btcAddress);
        });

        it("verify burn timeout", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.BurnRequested);

            await advanceTimeAndBlock(24 * 3600); // > WITHDRAW_VERIFICATION_END

            group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.BurnTimeout);

            await expect(system.connect(users[0]).verifyBurn(receiptId))
                .to.emit(system, "BurnVerified")
                .withArgs(receiptId, btcAddress, users[0].address);

            group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.MintGap);
        });

        it("mint without verify burn", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.BurnRequested);

            await advanceTimeAndBlock(24 * 60 * 60);

            group = await system.getGroup(btcAddress);
            expect(group.status).equal(GroupStatus.BurnTimeout);

            const nonce2 = nonce + 1;
            await expect(
                system.connect(users[1]).requestMint(btcAddress, GROUP_SATOSHI, nonce2)
            ).to.be.revertedWith("working receipt in progress");

            const receiptId2 = getReceiptId(btcAddress, nonce2);
            await expect(
                system.connect(users[1]).forceRequestMint(btcAddress, GROUP_SATOSHI, nonce2)
            )
                .to.emit(system, "BurnVerified")
                .withArgs(receiptId, btcAddress, users[1].address)
                .to.emit(system, "MintRequested")
                .withArgs(receiptId2, users[1].address, GROUP_SATOSHI, btcAddress);

            group = await system.getGroup(btcAddress);
            expect(group[2]).to.be.equal(0);
            expect(group[3]).to.be.equal(nonce2);
            expect(group.status).equal(GroupStatus.MintRequested);
            const receipt = await system.getReceipt(receiptId2);
            expect(receipt.status).to.be.equal(1);
        });
    });

    describe("refundBtc()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const nonce = 1;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;

        beforeEach(async function () {
            await addMockGroup();
        });

        it("refund recorded", async function () {
            const expiryTimestamp = (await system.REFUND_GAP()).add(1 + (await currentTime()));
            await expect(system.refundBtc(btcAddress, txId))
                .to.emit(system, "BtcRefunded")
                .withArgs(btcAddress, txId, expiryTimestamp);

            const refundData = await system.getRefundData();
            expect(refundData.groupBtcAddress).to.be.equal(btcAddress);
            expect(refundData.txId).to.be.equal(txId);
            expect(refundData.expiryTimestamp).to.be.equal(expiryTimestamp);
        });

        it("refund fail with verified mint", async function () {
            receiptId = await requestMint(users[0], btcAddress, nonce);
            await verifyMint(users[0], group1Verifiers, receiptId, txId, height);

            await expect(system.refundBtc(btcAddress, txId)).to.revertedWith(
                "receipt not in available state"
            );
        });

        it("refund with clear receipt", async function () {
            receiptId = await requestMint(users[0], btcAddress, nonce);

            await expect(system.refundBtc(btcAddress, txId)).to.revertedWith("deposit in progress");

            await advanceTimeAndBlock(24 * 3600);

            const expiryTimestamp = (await system.REFUND_GAP()).add(1 + (await currentTime()));

            await expect(system.refundBtc(btcAddress, txId))
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, btcAddress, deployer.address)
                .to.emit(system, "BtcRefunded")
                .withArgs(btcAddress, txId, expiryTimestamp);
        });

        it("refund cool down", async function () {
            const refundGap = await system.REFUND_GAP();
            const expiryTimestamp = refundGap.add(1 + (await currentTime()));
            await expect(system.refundBtc(btcAddress, txId))
                .to.emit(system, "BtcRefunded")
                .withArgs(btcAddress, txId, expiryTimestamp);

            const txId2 = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169be";
            await expect(system.refundBtc(btcAddress, txId2)).to.revertedWith("refund cool down");

            await advanceTimeAndBlock(24 * 3600);

            const expiryTimestamp2 = refundGap.add(1 + (await currentTime()));
            await expect(system.refundBtc(btcAddress, txId2))
                .to.emit(system, "BtcRefunded")
                .withArgs(btcAddress, txId2, expiryTimestamp2);
        });
    });
    describe("fee()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const btcAddress2 = BTC_ADDRESS[1];
        const withdrawBtcAddress = BTC_ADDRESS[2];
        const nonce = 1;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const groupCongAmount = GROUP_SATOSHI.mul(SATOSHI_CONG_MULTIPLIER);
        const mintFeeBps = 1;
        const burnFeeBps = 5;

        beforeEach(async function () {
            await addMockGroup();
            fee.updateMintFeeBps(mintFeeBps);
            fee.updateBurnFeeBps(burnFeeBps);
        });

        it("mint & burn", async function () {
            // first mint
            receiptId = await requestMint(users[0], btcAddress, nonce);
            await verifyMint(users[0], group1Verifiers, receiptId, txId, height);

            let userAmount = groupCongAmount.mul(10000 - mintFeeBps).div(10000);
            let systemAmount = groupCongAmount.mul(mintFeeBps).div(10000);
            expect(await cong.balanceOf(users[0].address)).to.equal(userAmount);
            expect(await cong.balanceOf(system.address)).to.equal(systemAmount);

            await advanceTimeAndBlock(24 * 3600);

            // second mint
            const receiptId2 = await requestMint(users[0], btcAddress2, nonce);
            await verifyMint(users[0], group2Verifiers, receiptId2, txId, height);

            systemAmount = systemAmount.mul(2);
            userAmount = userAmount.mul(2);
            expect(await cong.balanceOf(system.address)).to.equal(systemAmount);
            expect(await cong.balanceOf(users[0].address)).to.equal(userAmount);

            // burn
            const payAmount = groupCongAmount.mul(10000 + burnFeeBps).div(10000);
            systemAmount = systemAmount.add(groupCongAmount.mul(burnFeeBps).div(10000));
            await cong.connect(users[0]).approve(system.address, payAmount);
            await system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress);

            expect(await cong.balanceOf(system.address)).to.equal(
                systemAmount.add(groupCongAmount)
            );

            // verify burn
            await system.connect(users[0]).verifyBurn(receiptId);

            expect(await cong.balanceOf(system.address)).to.equal(systemAmount);

            // admin collect fee
            expect(await cong.balanceOf(deployer.address)).to.equal(0);

            await expect(system.connect(deployer).collectFee(systemAmount))
                .to.emit(system, "FeeCollected")
                .withArgs(deployer.address, systemAmount);

            expect(await cong.balanceOf(system.address)).to.equal(0);
            expect(await cong.balanceOf(deployer.address)).to.equal(systemAmount);
        });
    });
});
