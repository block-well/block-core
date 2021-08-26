import { expect } from "chai";
import { BigNumber, Wallet, constants, ContractTransaction } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
const { parseUnits, parseEther } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
import { prepareSignature, advanceTimeAndBlock, currentTime, getReceiptId, Status } from "./helper";
import {
    DeCusSystem,
    SATS,
    ERC20,
    KeeperRegistry,
    DCS,
    SwapRewarder,
    SwapFee,
} from "../build/typechain";
import { TimelockController } from "../build/typechain/TimelockController";

const SATOSHI_SATS_MULTIPLIER = BigNumber.from(10).pow(10);
const KEEPER_SATOSHI = parseBtc("0.5"); // 50000000
const GROUP_SATOSHI = parseBtc("0.6");
const BTC_ADDRESS = [
    "38aNsdfsdfsdfsdfsdfdsfsdf0",
    "38aNsdfsdfsdfsdfsdfdsfsdf1",
    "38aNsdfsdfsdfsdfsdfdsfsdf2",
];
const MINTER_ROLE = ethers.utils.id("MINTER_ROLE");

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture();

    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer
    const wbtc = (await ethers.getContract("WBTC")) as ERC20;
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;
    const system = (await ethers.getContract("DeCusSystem")) as DeCusSystem;
    const sats = (await ethers.getContract("SATS")) as SATS;
    const dcs = (await ethers.getContract("DCS")) as DCS;
    const rewarder = (await ethers.getContract("SwapRewarder")) as SwapRewarder;
    const fee = (await ethers.getContract("SwapFee")) as SwapFee;
    const timelockController = (await ethers.getContract(
        "TimelockController"
    )) as TimelockController;

    for (const user of users) {
        await wbtc.mint(user.address, parseBtc("100"));
        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await registry.connect(user).addKeeper(wbtc.address, KEEPER_SATOSHI);
    }

    return { deployer, users, system, registry, sats, dcs, rewarder, fee, timelockController };
});

describe("DeCusSystem", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let system: DeCusSystem;
    let registry: KeeperRegistry;
    let sats: SATS;
    let dcs: DCS;
    let rewarder: SwapRewarder;
    let fee: SwapFee;
    let timelockController: TimelockController;
    let group1Keepers: Wallet[];
    let group2Keepers: Wallet[];
    let group1Verifiers: Wallet[];
    let group2Verifiers: Wallet[];
    const GROUP_ROLE = ethers.utils.id("GROUP_ROLE");

    beforeEach(async function () {
        ({ deployer, users, system, registry, sats, dcs, rewarder, fee, timelockController } =
            await setupFixture());
        group1Keepers = [users[0], users[1], users[2], users[3]];
        group2Keepers = [users[0], users[1], users[4], users[5]];

        group1Verifiers = group1Keepers.slice(1);
        group2Verifiers = group2Keepers.slice(1);
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

    const addGroupAdmin = async (admin: Wallet) => {
        const delay = await timelockController.getMinDelay();
        const grantData = system
            .connect(deployer)
            .interface.encodeFunctionData("grantRole", [GROUP_ROLE, admin.address]);
        const revokeData = system
            .connect(deployer)
            .interface.encodeFunctionData("revokeRole", [GROUP_ROLE, deployer.address]);

        const salt = ethers.utils.randomBytes(32);
        const grantId = await timelockController.hashOperation(
            system.address,
            0,
            grantData,
            ethers.constants.HashZero,
            salt
        );
        await timelockController.schedule(
            system.address,
            0,
            grantData,
            ethers.constants.HashZero,
            salt,
            delay
        );

        const salt2 = ethers.utils.randomBytes(32);
        await timelockController
            .connect(deployer)
            .schedule(system.address, 0, revokeData, grantId, salt2, delay);

        await advanceTimeAndBlock(delay.toNumber());

        await timelockController.execute(
            system.address,
            0,
            grantData,
            ethers.constants.HashZero,
            salt
        );

        await timelockController.execute(system.address, 0, revokeData, grantId, salt2);
    };

    describe("addGroup()", function () {
        let groupAdmin: Wallet;

        beforeEach(async function () {
            groupAdmin = users[9];

            await addGroupAdmin(groupAdmin);

            // await system.connect(deployer).grantRole(GROUP_ROLE, groupAdmin.address);
            // await system.connect(deployer).revokeRole(GROUP_ROLE, deployer.address);
        });

        it("update minKeeperCollaternal", async function () {
            expect(await registry.minKeeperCollateral()).to.be.gt(parseEther("0.000001"));
            const minKeeperWei = parseEther("1");
            expect(await registry.minKeeperCollateral()).to.be.lt(minKeeperWei);

            const delay = await timelockController.getMinDelay();
            const data = registry.interface.encodeFunctionData("updateMinKeeperCollateral", [
                minKeeperWei,
            ]);
            const salt = ethers.utils.randomBytes(32);
            await timelockController.schedule(
                registry.address,
                0,
                data,
                ethers.constants.HashZero,
                salt,
                delay
            );
            await advanceTimeAndBlock(delay.toNumber());

            await expect(
                timelockController.execute(
                    registry.address,
                    0,
                    data,
                    ethers.constants.HashZero,
                    salt
                )
            )
                .to.emit(registry, "MinCollateralUpdated")
                .withArgs(minKeeperWei);

            // await expect(registry.connect(deployer).updateMinKeeperCollateral(minKeeperWei))
            //     .to.emit(registry, "MinCollateralUpdated")
            //     .withArgs(minKeeperWei);

            const keepers = group1Keepers.map((x) => x.address);
            await expect(
                system.connect(groupAdmin).addGroup(BTC_ADDRESS[0], 3, GROUP_SATOSHI, keepers)
            ).to.revertedWith("keeper has insufficient collateral");
        });

        it("should add group", async function () {
            const keepers = group1Keepers.map((x) => x.address);
            await expect(
                system.connect(groupAdmin).addGroup(BTC_ADDRESS[0], 3, GROUP_SATOSHI, keepers)
            )
                .to.emit(system, "GroupAdded")
                .withArgs(BTC_ADDRESS[0], 3, GROUP_SATOSHI, keepers);

            const group = await system.getGroup(BTC_ADDRESS[0]);
            expect(group.required).equal(BigNumber.from(3));
            expect(group.maxSatoshi).equal(BigNumber.from(GROUP_SATOSHI));
            expect(group.currSatoshi).equal(BigNumber.from(0));
            expect(group.nonce).equal(BigNumber.from(0));
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
        const userSatsAmount = amountInSatoshi.mul(10 ** 10);
        const nonce = 1;
        const receiptId = getReceiptId(btcAddress, nonce);
        let keepers: string[];
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;

        beforeEach(async function () {
            keepers = group1Keepers.map((x) => x.address);

            await system.addGroup(btcAddress, 3, amountInSatoshi, keepers);

            await fee.connect(deployer).updateBurnFeeBps(0); // skip burn fee
            await fee.connect(deployer).updateMintEthGasPrice(0); // skip mint fee
        });

        it("delete not exist", async function () {
            await expect(system.deleteGroup(BTC_ADDRESS[1]))
                .to.emit(system, "GroupDeleted")
                .withArgs(BTC_ADDRESS[1]);
        });

        it("should delete group by group admin", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.required).equal(BigNumber.from(3));
            expect(group.maxSatoshi).equal(BigNumber.from(amountInSatoshi));
            expect(group.currSatoshi).equal(BigNumber.from(0));
            expect(group.nonce).equal(BigNumber.from(0));
            expect(group.keepers).deep.equal(keepers);
            expect(group.workingReceiptId).equal(
                await system.getReceiptId(btcAddress, group.nonce)
            );

            await expect(system.connect(deployer).deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);

            group = await system.getGroup(btcAddress);
            expect(group.required).equal(BigNumber.from(0));
            expect(group.maxSatoshi).equal(BigNumber.from(0));
            expect(group.currSatoshi).equal(BigNumber.from(0));
            expect(group.nonce).equal(BigNumber.from(0));
            expect(group.keepers).deep.equal([]);
            expect(group.workingReceiptId).equal(await system.getReceiptId(btcAddress, 0));
        });

        const allowKeeperExit = async () => {
            const delay = await timelockController.getMinDelay();
            const salt = ethers.utils.randomBytes(32);
            const data = system.interface.encodeFunctionData("allowKeeperExit");
            await timelockController.schedule(
                system.address,
                0,
                data,
                ethers.constants.HashZero,
                salt,
                delay
            );
            await advanceTimeAndBlock(delay.toNumber());
            await timelockController.execute(
                system.address,
                0,
                data,
                ethers.constants.HashZero,
                salt
            );
        };

        it("should delete group by keeper in the group", async function () {
            const keeperInGroup = users[0];
            const keeperNotInGroup = users[4];

            await expect(system.connect(keeperNotInGroup).deleteGroup(btcAddress)).to.revertedWith(
                "not authorized"
            );
            await expect(system.connect(keeperInGroup).deleteGroup(btcAddress)).to.revertedWith(
                "not authorized"
            );

            await allowKeeperExit();
            // await expect(system.connect(deployer).allowKeeperExit())
            //     .to.emit(system, "AllowKeeperExit")
            //     .withArgs(deployer.address);

            await expect(system.connect(keeperNotInGroup).deleteGroup(btcAddress)).to.revertedWith(
                "not authorized"
            );
            await expect(system.connect(keeperInGroup).deleteGroup(btcAddress)).to.revertedWith(
                "not authorized"
            );

            expect(await system.keeperExiting(keeperInGroup.address)).to.be.false;
            await expect(system.connect(keeperInGroup).toggleExitKeeper())
                .to.emit(system, "ToggleExitKeeper")
                .withArgs(keeperInGroup.address, true);
            expect(await system.keeperExiting(keeperInGroup.address)).to.be.true;
            await expect(system.connect(keeperNotInGroup).toggleExitKeeper())
                .to.emit(system, "ToggleExitKeeper")
                .withArgs(keeperNotInGroup.address, true);

            await expect(system.connect(keeperNotInGroup).deleteGroup(btcAddress)).to.revertedWith(
                "not authorized"
            );
            await expect(system.connect(keeperInGroup).deleteGroup(btcAddress))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress);
        });

        it("delete groups by group admin", async function () {
            const btcAddress2 = BTC_ADDRESS[1];
            await system.addGroup(
                btcAddress2,
                3,
                GROUP_SATOSHI,
                group2Keepers.map((x) => x.address)
            );

            await expect(system.connect(deployer).deleteGroups([btcAddress, btcAddress2]))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress)
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress2);
        });

        it("delete groups by keeper", async function () {
            const keeperInGroup = users[0];
            const keeperNotInGroup = users[4];
            const btcAddress2 = BTC_ADDRESS[1];
            await system.addGroup(
                btcAddress2,
                3,
                GROUP_SATOSHI,
                group2Keepers.map((x) => x.address)
            );

            await allowKeeperExit();
            // await system.connect(deployer).allowKeeperExit();

            await system.connect(keeperNotInGroup).toggleExitKeeper();
            await expect(
                system.connect(keeperNotInGroup).deleteGroups([btcAddress, btcAddress2])
            ).to.revertedWith("not authorized");

            await system.connect(keeperInGroup).toggleExitKeeper();
            await expect(system.connect(keeperInGroup).deleteGroups([btcAddress, btcAddress2]))
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress)
                .to.emit(system, "GroupDeleted")
                .withArgs(btcAddress2);

            await expect(
                system.connect(keeperNotInGroup).deleteGroups([btcAddress, btcAddress2])
            ).to.revertedWith("not authorized");
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
            await sats.connect(users[0]).approve(system.address, userSatsAmount);
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
            await sats.connect(users[0]).approve(system.address, userSatsAmount);
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
        nonce: number,
        mintEthFee: BigNumber
    ): Promise<string> => {
        await system
            .connect(user)
            .requestMint(btcAddress, GROUP_SATOSHI, nonce, { value: mintEthFee });
        return getReceiptId(btcAddress, nonce);
    };

    const verifyMint = async (
        user: Wallet,
        keepers: Wallet[],
        receiptId: string,
        txId: string,
        height: number
    ): Promise<ContractTransaction> => {
        const [rList, sList, packedV] = await prepareSignature(
            keepers,
            system.address,
            receiptId,
            txId,
            height
        );

        const keeperAddresses = keepers.map((x) => x.address);
        return await system
            .connect(user)
            .verifyMint({ receiptId, txId, height }, keeperAddresses, rList, sList, packedV);
    };

    describe("requestMint()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const amountInSatoshi = GROUP_SATOSHI;
        const nonce = 1;
        const receiptId = getReceiptId(btcAddress, nonce);
        let mintEthFee: BigNumber;

        beforeEach(async function () {
            await addMockGroup();
            mintEthFee = await fee.getMintEthFee();
        });

        it("invalid nonce", async function () {
            await expect(
                system
                    .connect(users[0])
                    .requestMint(btcAddress, amountInSatoshi, nonce + 1, { value: mintEthFee })
            ).to.revertedWith("invalid nonce");
        });

        it("should request mint", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce - 1);

            await expect(
                system
                    .connect(users[0])
                    .requestMint(btcAddress, amountInSatoshi, nonce, { value: mintEthFee })
            )
                .to.emit(system, "MintRequested")
                .withArgs(receiptId, users[0].address, amountInSatoshi, BTC_ADDRESS[0]);

            expect(mintEthFee).to.gt(1e9);
            expect(await ethers.provider.getBalance(fee.address)).to.equal(mintEthFee);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);
        });

        it("revoke mint", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce - 1);
            expect((await system.getGroup(btcAddress))[3]).to.equal(nonce - 1);

            await system
                .connect(users[0])
                .requestMint(btcAddress, amountInSatoshi, nonce, { value: mintEthFee });

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);
            expect((await system.getReceipt(receiptId)).status).to.equal(1);

            await expect(system.connect(users[1]).revokeMint(receiptId)).to.revertedWith(
                "require receipt recipient"
            );

            await expect(system.connect(users[0]).revokeMint(receiptId))
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, btcAddress, users[0].address);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);
            expect((await system.getReceipt(receiptId)).status).to.equal(0);
        });

        it("force mint request", async function () {
            let group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce - 1);

            await system
                .connect(users[0])
                .requestMint(btcAddress, amountInSatoshi, nonce, { value: mintEthFee });

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);

            const nonce2 = nonce + 1;
            await expect(
                system.connect(users[1]).forceRequestMint(btcAddress, GROUP_SATOSHI, nonce2)
            ).to.revertedWith("deposit in progress");

            await advanceTimeAndBlock(24 * 3600);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce);

            const receiptId2 = getReceiptId(btcAddress, nonce2);
            await expect(
                system
                    .connect(users[1])
                    .forceRequestMint(btcAddress, GROUP_SATOSHI, nonce2, { value: mintEthFee })
            )
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, btcAddress, users[1].address)
                .to.emit(system, "MintRequested")
                .withArgs(receiptId2, users[1].address, GROUP_SATOSHI, btcAddress);

            group = await system.getGroup(btcAddress);
            expect(group.nonce).equal(nonce + 1);
        });
    });

    describe("verifyMint()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const nonce = 1;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const groupSatsAmount = GROUP_SATOSHI.mul(SATOSHI_SATS_MULTIPLIER);
        let mintEthFee: BigNumber;

        beforeEach(async function () {
            await addMockGroup();

            mintEthFee = await fee.getMintEthFee();
            receiptId = await requestMint(users[0], btcAddress, nonce, mintEthFee);
        });

        it("should verify mint", async function () {
            let receipt = await system.getReceipt(receiptId);
            let group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(Status.DepositRequested);
            expect(receipt.txId).to.be.equal(constants.HashZero);
            expect(receipt.height).to.be.equal(0);
            expect(group[2]).to.be.equal(0);
            expect(group[3]).to.be.equal(nonce);

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
                .withArgs(receiptId, btcAddress, keeperAddresses, txId, height);

            receipt = await system.getReceipt(receiptId);
            group = await system.getGroup(btcAddress);
            expect(receipt.status).to.be.equal(Status.DepositReceived);
            expect(receipt.txId).to.be.equal(txId);
            expect(receipt.height).to.be.equal(height);
            expect(group[2]).to.be.equal(GROUP_SATOSHI);
            expect(group[3]).to.be.equal(nonce);

            expect(await sats.balanceOf(users[0].address)).to.be.equal(groupSatsAmount);
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
            await advanceTimeAndBlock(24 * 3600); // > MINT_REQUEST_GRACE_PERIOD

            let group = await system.getGroup(btcAddress);
            expect(group.currSatoshi).equal(0);

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
                .withArgs(receiptId, btcAddress, keeperAddresses, txId, height);

            group = await system.getGroup(btcAddress);
            expect(group.currSatoshi).equal(GROUP_SATOSHI);
        });

        it("forbit verify for outdated receipt", async function () {
            await advanceTimeAndBlock(24 * 3600);

            const nonce2 = nonce + 1;
            const receiptId2 = getReceiptId(btcAddress, nonce2);
            await expect(
                system
                    .connect(users[1])
                    .forceRequestMint(btcAddress, GROUP_SATOSHI, nonce2, { value: mintEthFee })
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
        const userSatsAmount = GROUP_SATOSHI.mul(SATOSHI_SATS_MULTIPLIER);
        let mintEthFee: BigNumber;

        beforeEach(async function () {
            await addMockGroup();

            mintEthFee = await fee.getMintEthFee();
            receiptId = await requestMint(users[0], btcAddress, nonce, mintEthFee);

            await verifyMint(users[0], group1Verifiers, receiptId, txId, height);
        });

        const getSatsForBurn = async (user: Wallet, amount: BigNumber) => {
            // await sats.connect(deployer).grantRole(MINTER_ROLE, deployer.address);
            // await sats.connect(deployer).mint(user.address, amount);
            const delay = await timelockController.getMinDelay();
            const grantData = sats.interface.encodeFunctionData("grantRole", [
                MINTER_ROLE,
                deployer.address,
            ]);
            const salt = ethers.utils.randomBytes(32);
            await timelockController.schedule(
                sats.address,
                0,
                grantData,
                ethers.constants.HashZero,
                salt,
                delay
            );

            await advanceTimeAndBlock(delay.toNumber());

            await timelockController.execute(
                sats.address,
                0,
                grantData,
                ethers.constants.HashZero,
                salt
            );

            await sats.connect(deployer).mint(user.address, amount);
        };

        it("request burn", async function () {
            const redeemer = users[1];
            await sats.connect(users[0]).transfer(redeemer.address, userSatsAmount);

            let receipt = await system.getReceipt(receiptId);
            expect(receipt.recipient).to.equal(users[0].address);

            let burnAmount = userSatsAmount;

            // require extra burn fee to burn
            const burnFeeAmount = await fee.getBurnFeeAmount(burnAmount);
            if (burnFeeAmount.gt(0)) {
                await getSatsForBurn(redeemer, burnFeeAmount);
                burnAmount = burnAmount.add(burnFeeAmount);
            }

            expect(await sats.balanceOf(redeemer.address)).to.equal(burnAmount);
            await sats.connect(redeemer).approve(system.address, burnAmount);
            await expect(system.connect(redeemer).requestBurn(receiptId, withdrawBtcAddress))
                .to.emit(system, "BurnRequested")
                .withArgs(receiptId, btcAddress, withdrawBtcAddress, redeemer.address);

            receipt = await system.getReceipt(receiptId);
            expect(receipt.recipient).to.equal(redeemer.address);
            expect(receipt.status).to.be.equal(3);
            expect(receipt.withdrawBtcAddress).to.be.equal(withdrawBtcAddress);
            expect(await sats.balanceOf(redeemer.address)).to.be.equal(0);
            expect(await sats.balanceOf(system.address)).to.be.equal(userSatsAmount);
            expect(await sats.balanceOf(fee.address)).to.be.equal(burnFeeAmount);
        });

        const recoverBurn = async (receiptId: string) => {
            const delay = await timelockController.getMinDelay();
            const salt = ethers.utils.randomBytes(32);
            const data = system.interface.encodeFunctionData("recoverBurn", [receiptId]);
            await timelockController.schedule(
                system.address,
                0,
                data,
                ethers.constants.HashZero,
                salt,
                delay
            );
            await advanceTimeAndBlock(delay.toNumber());
            return timelockController.execute(
                system.address,
                0,
                data,
                ethers.constants.HashZero,
                salt
            );
        };

        it("recover burn", async function () {
            const redeemer = users[0];
            expect(await sats.balanceOf(redeemer.address)).to.be.equal(userSatsAmount);

            let burnAmount = userSatsAmount;

            // require extra burn fee to burn
            const burnFeeAmount = await fee.getBurnFeeAmount(burnAmount);
            if (burnFeeAmount.gt(0)) {
                await getSatsForBurn(redeemer, burnFeeAmount);
                burnAmount = burnAmount.add(burnFeeAmount);
            }

            expect(await sats.balanceOf(redeemer.address)).to.equal(burnAmount);
            await sats.connect(redeemer).approve(system.address, burnAmount);
            await expect(system.connect(redeemer).requestBurn(receiptId, withdrawBtcAddress))
                .to.emit(system, "BurnRequested")
                .withArgs(receiptId, btcAddress, withdrawBtcAddress, redeemer.address);

            expect(await sats.balanceOf(redeemer.address)).to.be.equal(0);
            let receipt = await system.getReceipt(receiptId);
            expect(receipt.status).to.equal(Status.WithdrawRequested);

            await expect(system.connect(redeemer).recoverBurn(receiptId)).to.revertedWith(
                "require admin role"
            );

            const tx = await recoverBurn(receiptId);
            expect(tx)
                .to.emit(system, "BurnRevoked")
                .withArgs(receiptId, btcAddress, redeemer.address, timelockController.address);

            receipt = await system.getReceipt(receiptId);
            expect(receipt.status).to.equal(Status.DepositReceived);
            expect(await sats.balanceOf(redeemer.address)).to.be.equal(userSatsAmount);
            expect(await sats.balanceOf(fee.address)).to.be.equal(burnFeeAmount);
        });
    });

    describe("verifyBurn()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const withdrawBtcAddress = BTC_ADDRESS[1];
        const nonce = 1;
        let receiptId: string;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const userSatsAmount = GROUP_SATOSHI.mul(SATOSHI_SATS_MULTIPLIER);

        beforeEach(async function () {
            await addMockGroup();

            await fee.connect(deployer).updateBurnFeeBps(0); // skip burn fee
            await fee.connect(deployer).updateMintEthGasPrice(0); // skip mint fee

            receiptId = await requestMint(users[0], btcAddress, nonce, BigNumber.from(0));

            await verifyMint(users[0], group1Verifiers, receiptId, txId, height);

            await sats.connect(users[0]).approve(system.address, userSatsAmount);
            await system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress);
        });

        it("verify burn", async function () {
            await expect(system.connect(users[0]).verifyBurn(receiptId))
                .to.emit(system, "BurnVerified")
                .withArgs(receiptId, btcAddress, users[0].address);

            const receipt = await system.getReceipt(receiptId);
            expect(receipt.status).to.be.equal(0);
            expect(await sats.balanceOf(users[0].address)).to.be.equal(0);
            expect(await sats.balanceOf(system.address)).to.be.equal(0);

            const nonce2 = nonce + 1;
            const receiptId2 = getReceiptId(btcAddress, nonce2);

            await expect(
                system.connect(users[1]).requestMint(btcAddress, GROUP_SATOSHI, nonce2)
            ).to.revertedWith("group cooling down");

            await advanceTimeAndBlock(3600);

            await expect(system.connect(users[1]).requestMint(btcAddress, GROUP_SATOSHI, nonce2))
                .to.emit(system, "MintRequested")
                .withArgs(receiptId2, users[1].address, GROUP_SATOSHI, btcAddress);
        });

        it("verify burn timeout", async function () {
            await advanceTimeAndBlock(24 * 3600); // > WITHDRAW_VERIFICATION_END

            await expect(system.connect(users[0]).verifyBurn(receiptId))
                .to.emit(system, "BurnVerified")
                .withArgs(receiptId, btcAddress, users[0].address);
        });

        it("mint without verify burn", async function () {
            await advanceTimeAndBlock(24 * 60 * 60);

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

            const group = await system.getGroup(btcAddress);
            expect(group[2]).to.be.equal(0);
            expect(group[3]).to.be.equal(nonce2);
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
        let mintEthFee: BigNumber;

        beforeEach(async function () {
            mintEthFee = await fee.getMintEthFee();
            await addMockGroup();
        });

        const refundBtc = async (btcAddress: string, txId: string) => {
            const delay = await timelockController.getMinDelay();
            const salt = ethers.utils.randomBytes(32);
            const data = system.interface.encodeFunctionData("refundBtc", [btcAddress, txId]);
            await timelockController.schedule(
                system.address,
                0,
                data,
                ethers.constants.HashZero,
                salt,
                delay
            );
            await advanceTimeAndBlock(delay.toNumber());
            return timelockController.execute(
                system.address,
                0,
                data,
                ethers.constants.HashZero,
                salt
            );
        };

        it("refund recorded", async function () {
            const tx = await refundBtc(btcAddress, txId);
            const expiryTimestamp = (await system.REFUND_GAP()) + (await currentTime());
            expect(tx).to.emit(system, "BtcRefunded").withArgs(btcAddress, txId, expiryTimestamp);

            const refundData = await system.getRefundData();
            expect(refundData.groupBtcAddress).to.be.equal(btcAddress);
            expect(refundData.txId).to.be.equal(txId);
            expect(refundData.expiryTimestamp).to.be.equal(expiryTimestamp);
        });

        it("refund fail with verified mint", async function () {
            receiptId = await requestMint(users[0], btcAddress, nonce, mintEthFee);
            await verifyMint(users[0], group1Verifiers, receiptId, txId, height);

            // expect(tx).to.revertedWith("receipt not in available state");
            await expect(refundBtc(btcAddress, txId)).to.revertedWith(
                "TimelockController: underlying transaction reverted"
            );
        });

        it("refund with clear receipt", async function () {
            receiptId = await requestMint(users[0], btcAddress, nonce, mintEthFee);

            // expect(tx).to.revertedWith("deposit in progress");
            await expect(refundBtc(btcAddress, txId)).to.revertedWith(
                "TimelockController: underlying transaction reverted"
            );

            await advanceTimeAndBlock(24 * 3600);

            const tx = await refundBtc(btcAddress, txId);
            const expiryTimestamp = (await system.REFUND_GAP()) + (1 + (await currentTime()));

            expect(tx)
                .to.emit(system, "MintRevoked")
                .withArgs(receiptId, btcAddress, deployer.address)
                .to.emit(system, "BtcRefunded")
                .withArgs(btcAddress, txId, expiryTimestamp);
        });

        it("refund cool down", async function () {
            const txId2 = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169be";
            const delay = await timelockController.getMinDelay();
            const salt = ethers.utils.randomBytes(32);
            const data = system.interface.encodeFunctionData("refundBtc", [btcAddress, txId2]);
            await timelockController.schedule(
                system.address,
                0,
                data,
                ethers.constants.HashZero,
                salt,
                delay
            );

            await refundBtc(btcAddress, txId);

            await expect(
                timelockController.execute(system.address, 0, data, ethers.constants.HashZero, salt)
            ).to.revertedWith("TimelockController: underlying transaction reverted");
            // ).to.revertedWith("refund cool down");

            // await expect(system.refundBtc(btcAddress, txId2)).to.revertedWith("refund cool down");

            await advanceTimeAndBlock(24 * 3600);

            await refundBtc(btcAddress, txId2);
        });
    });
    describe("fee() & reward()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const btcAddress2 = BTC_ADDRESS[1];
        const withdrawBtcAddress = BTC_ADDRESS[2];
        const nonce = 1;
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;
        const groupSatsAmount = GROUP_SATOSHI.mul(SATOSHI_SATS_MULTIPLIER);
        const mintFeeBps = 1;
        const burnFeeBps = 5;
        let dcsMintReward: BigNumber;
        let dcsBurnReward: BigNumber;
        let mintEthFee: BigNumber;

        beforeEach(async function () {
            await addMockGroup();
            await fee.connect(deployer).updateMintFeeBps(mintFeeBps);
            await fee.connect(deployer).updateBurnFeeBps(burnFeeBps);
            mintEthFee = await fee.getMintEthFee();

            dcsMintReward = await rewarder.mintRewardAmount();
            dcsBurnReward = await rewarder.burnRewardAmount();
        });

        it("reward not empty", async function () {
            expect(dcsMintReward).to.gt(parseEther("1"));
            expect(dcsBurnReward).to.gt(parseEther("1"));
        });

        it("mint & burn", async function () {
            const user = users[0];

            let dcsReward = BigNumber.from(0);
            expect(await dcs.balanceOf(user.address)).to.equal(dcsReward);

            // first mint
            const receiptId = await requestMint(user, btcAddress, nonce, mintEthFee);
            let tx = await verifyMint(user, group1Verifiers, receiptId, txId, height);
            expect(tx).emit(rewarder, "SwapRewarded").withArgs(user.address, dcsMintReward, true);

            const mintFeeAmount = groupSatsAmount.mul(mintFeeBps).div(10000);
            let userAmount = groupSatsAmount.sub(mintFeeAmount);
            let totalFeeAmount = mintFeeAmount;
            expect(await sats.balanceOf(user.address)).to.equal(userAmount);
            expect(await sats.balanceOf(fee.address)).to.equal(totalFeeAmount);

            dcsReward = dcsReward.add(dcsMintReward);
            expect(await dcs.balanceOf(user.address)).to.equal(dcsReward);

            await advanceTimeAndBlock(24 * 3600);

            // second mint
            const receiptId2 = await requestMint(user, btcAddress2, nonce, mintEthFee);
            tx = await verifyMint(user, group2Verifiers, receiptId2, txId, height);
            expect(tx).emit(rewarder, "SwapRewarded").withArgs(user.address, dcsMintReward, true);

            totalFeeAmount = totalFeeAmount.mul(2);
            userAmount = userAmount.mul(2);
            expect(await sats.balanceOf(fee.address)).to.equal(totalFeeAmount);
            expect(await sats.balanceOf(user.address)).to.equal(userAmount);

            dcsReward = dcsReward.add(dcsMintReward);
            expect(await dcs.balanceOf(user.address)).to.equal(dcsReward);

            // burn
            const burnFeeAmount = groupSatsAmount.mul(burnFeeBps).div(10000);
            const payAmount = groupSatsAmount.add(burnFeeAmount);
            totalFeeAmount = totalFeeAmount.add(burnFeeAmount);
            await sats.connect(user).approve(system.address, payAmount);
            await system.connect(user).requestBurn(receiptId, withdrawBtcAddress);

            expect(await sats.balanceOf(fee.address)).to.equal(totalFeeAmount);

            expect(await dcs.balanceOf(user.address)).to.equal(dcsReward);

            // verify burn
            await expect(system.connect(user).verifyBurn(receiptId))
                .to.emit(rewarder, "SwapRewarded")
                .withArgs(user.address, dcsBurnReward, false);

            expect(await sats.balanceOf(fee.address)).to.equal(totalFeeAmount);

            dcsReward = dcsReward.add(dcsBurnReward);
            expect(await dcs.balanceOf(user.address)).to.equal(dcsReward);

            // admin collect fee
            expect(await sats.balanceOf(deployer.address)).to.equal(0);

            await expect(fee.connect(deployer).collectSats(totalFeeAmount))
                .to.emit(fee, "SatsCollected")
                .withArgs(deployer.address, sats.address, totalFeeAmount);

            expect(await sats.balanceOf(fee.address)).to.equal(0);
            expect(await sats.balanceOf(deployer.address)).to.equal(totalFeeAmount);

            // admin collect ether to coordinator
            const etherAmount = await ethers.provider.getBalance(fee.address);
            const coordinator = ethers.Wallet.createRandom();

            expect(await ethers.provider.getBalance(coordinator.address)).to.equal(0);

            await expect(fee.connect(deployer).collectEther(coordinator.address, etherAmount))
                .to.emit(fee, "EtherCollected")
                .withArgs(coordinator.address, etherAmount);

            expect(await ethers.provider.getBalance(fee.address)).to.equal(0);
            expect(await ethers.provider.getBalance(coordinator.address)).to.equal(etherAmount);
        });
    });

    describe("pause()", function () {
        const btcAddress = BTC_ADDRESS[0];
        const withdrawBtcAddress = BTC_ADDRESS[1];
        const amountInSatoshi = GROUP_SATOSHI;
        const nonce = 1;
        const receiptId = getReceiptId(btcAddress, nonce);
        const txId = "0xa1658ce2e63e9f91b6ff5e75c5a69870b04de471f5cd1cc3e53be158b46169bd";
        const height = 1940801;

        beforeEach(async function () {
            await addMockGroup();

            await system.pause();
        });

        it("pause for group", async function () {
            await expect(
                system
                    .connect(deployer)
                    .addGroup(btcAddress, 2, amountInSatoshi, [users[2].address, users[3].address])
            ).to.revertedWith("Pausable: paused");

            await expect(system.connect(deployer).deleteGroup(btcAddress)).to.revertedWith(
                "Pausable: paused"
            );
        });

        it("pause for mint & burn", async function () {
            await expect(
                system.connect(users[0]).requestMint(btcAddress, amountInSatoshi, nonce)
            ).to.revertedWith("Pausable: paused");

            const [rList, sList, packedV] = await prepareSignature(
                group1Verifiers,
                system.address,
                receiptId,
                txId,
                height
            );

            const keeperAddresses = group1Verifiers.map((x) => x.address);
            await expect(
                system
                    .connect(users[0])
                    .verifyMint({ receiptId, txId, height }, keeperAddresses, rList, sList, packedV)
            ).to.revertedWith("Pausable: paused");

            await expect(
                system.connect(users[0]).requestBurn(receiptId, withdrawBtcAddress)
            ).to.revertedWith("Pausable: paused");

            await expect(system.connect(users[0]).verifyBurn(receiptId)).to.revertedWith(
                "Pausable: paused"
            );
        });
    });
});
