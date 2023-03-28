import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Wallet, constants, BigNumber } from "ethers";
import { deployments, ethers } from "hardhat";
import {
    KeeperRegistry,
    ERC20,
    BtcRater,
    DeCusSystem,
    Liquidation,
    MockERC20,
} from "../build/typechain";
import { advanceTimeAndBlock, currentTime } from "./helper";

const { parseEther, parseUnits } = ethers.utils;
const parseBtcInSats = (value: string) => parseUnits(value, 18);
const BTC_TO_SATS = 1e8;

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture(["TestToken"]);

    const { deployer } = await ethers.getNamedSigners();
    const users = await ethers.getUnnamedSigners();

    const btc = (await ethers.getContract("BTC")) as MockERC20;

    await deployments.deploy("SATS", { from: deployer.address });
    await deployments.execute(
        "SATS",
        { from: deployer.address },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        deployer.address
    );
    const sats = (await ethers.getContract("SATS")) as MockERC20;

    const dcs = await deployments.deploy("DCS", { from: deployer.address });

    await deployments.deploy("MockHBTC", {
        contract: "MockERC20",
        args: ["HBTC", "HBTC", 18],
        from: deployer.address,
    });
    const hbtc = (await ethers.getContract("MockHBTC")) as MockERC20;

    await deployments.deploy("DeCusSystem", { from: deployer.address, args: [] });

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [btc.address, hbtc.address],
            [1, 1],
        ],
    });

    const rater = (await ethers.getContract("BtcRater")) as BtcRater;

    await deployments.deploy("KeeperRegistry", {
        from: deployer.address,
        args: [[btc.address, hbtc.address], sats.address, rater.address, 1e14],
    });
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;
    const system = (await ethers.getContract("DeCusSystem")) as DeCusSystem;

    const fee = await deployments.deploy("SwapFee", {
        contract: "SwapFeeDcs",
        from: deployer.address,
        args: [0, 50, 11111, sats.address, system.address],
    });

    const rewarder = await deployments.deploy("SwapRewarder", {
        from: deployer.address,
        args: [dcs.address, system.address, parseEther("40"), parseEther("10")],
    });

    await deployments.execute(
        "DeCusSystem",
        { from: deployer.address },
        "initialize",
        sats.address,
        registry.address,
        rewarder.address,
        fee.address
    );

    await deployments.execute(
        "KeeperRegistry",
        { from: deployer.address },
        "setSystem",
        system.address
    );

    const btcDecimals = await btc.decimals();
    for (const user of users) {
        await btc.mint(user.address, parseUnits("100", btcDecimals));
        await hbtc.mint(user.address, parseEther("100"));
        await sats.connect(deployer).mint(user.address, parseBtcInSats("100"));

        await btc.connect(user).approve(registry.address, parseUnits("100", btcDecimals));
        await hbtc.connect(user).approve(registry.address, parseEther("100"));
        await sats.connect(user).approve(registry.address, parseBtcInSats("100"));
    }

    return { users, deployer, btc, hbtc, sats, registry, rater, system };
});

describe("KeeperRegistry", function () {
    let deployer: SignerWithAddress;
    let users: SignerWithAddress[];
    let btc: ERC20;
    let hbtc: ERC20;
    let sats: ERC20;
    let rater: BtcRater;
    let registry: KeeperRegistry;
    let system: DeCusSystem;
    let btcDecimals = 0;

    beforeEach(async function () {
        ({ users, deployer, btc, hbtc, sats, registry, rater, system } = await setupFixture());
        btcDecimals = await btc.decimals();
    });

    const parseBtc = (value: string) => parseUnits(value, btcDecimals);

    describe("addAsset()", function () {
        it("should add asset", async function () {
            const MockWBTC = await ethers.getContractFactory("MockWBTC");
            const btc2 = await MockWBTC.connect(deployer).deploy();

            await deployments.deploy("HBTC2", {
                contract: "MockERC20",
                from: deployer.address,
                args: ["HBTC2", "HBTC2", 18],
            });
            const hbtc2 = await ethers.getContract("HBTC2");

            await expect(registry.connect(deployer).addAsset(btc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(btc2.address);

            await expect(registry.connect(deployer).addAsset(hbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(hbtc2.address);
        });
    });

    describe("addKeeper()", function () {
        it("should add keeper", async function () {
            const amountInBtc = "10";
            const btcAmount = parseBtc(amountInBtc);
            const asset = btc.address;

            let keeperData = await registry.getKeeper(users[0].address);
            expect(keeperData.asset).to.equal(constants.AddressZero);
            expect(keeperData.amount).to.equal(0);
            expect(keeperData.refCount).to.equal(0);
            expect(keeperData.joinTimestamp).to.equal(0);

            expect(await btc.balanceOf(users[0].address)).to.be.equal(parseBtc("100"));
            expect(await btc.balanceOf(registry.address)).to.be.equal(parseBtc("0"));
            expect(await hbtc.balanceOf(users[0].address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);

            const amountIn18Decimal = parseEther(amountInBtc);
            await expect(registry.connect(users[0]).addKeeper(asset, btcAmount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, asset, amountIn18Decimal);

            keeperData = await registry.getKeeper(users[0].address);
            expect(keeperData.asset).to.equal(asset);
            expect(keeperData.amount).to.equal(amountIn18Decimal);
            expect(keeperData.refCount).to.equal(0);
            expect(keeperData.joinTimestamp).to.equal(await currentTime());

            expect(await btc.balanceOf(users[0].address)).to.be.equal(parseBtc("90"));
            expect(await btc.balanceOf(registry.address)).to.be.equal(parseBtc("10"));
            expect(await hbtc.balanceOf(users[0].address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);

            // Check CToken amount
            expect(await registry.balanceOf(users[0].address)).to.be.equal(amountIn18Decimal);
        });

        it("not enough collateral", async function () {
            const asset = btc.address;
            const minKeeperCollateral = await registry.minKeeperCollateral();
            const amountInBtc = ethers.utils.formatUnits(minKeeperCollateral, 18);
            const btcAmount = parseBtc(amountInBtc);
            const amountIn18Decimal = parseEther(amountInBtc);

            expect(await registry.isKeeperQualified(users[0].address)).to.be.false;

            await expect(
                registry.connect(users[0]).addKeeper(asset, btcAmount.sub(1))
            ).to.revertedWith("not enough collateral");

            await expect(registry.connect(users[0]).addKeeper(asset, btcAmount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, asset, amountIn18Decimal);

            expect(await registry.isKeeperQualified(users[0].address)).to.be.true;
        });
    });

    describe("deleteKeeper()", function () {
        const keeperBtcAmount = "0.5";
        const keeperAmountIn18Decimal = parseEther(keeperBtcAmount);
        const KEEPER_NUMBER = 6;
        const BTC_ADDRESS = [
            "38aNsdfsdfsdfsdfsdfdsfsdf0",
            "38aNsdfsdfsdfsdfsdfdsfsdf1",
            "38aNsdfsdfsdfsdfsdfdsfsdf2",
        ];
        const GROUP_SATOSHI = parseUnits("0.6", 8);
        let btcAmount: BigNumber;
        let group1Keepers: SignerWithAddress[];
        let group2Keepers: SignerWithAddress[];

        beforeEach(async function () {
            btcAmount = parseBtc(keeperBtcAmount);
            await registry.connect(deployer).addAsset(sats.address);
            await rater.connect(deployer).updateRates(sats.address, BTC_TO_SATS);

            group1Keepers = [users[0], users[1], users[2], users[3]];
            group2Keepers = [users[0], users[1], users[4], users[5]];

            const asset = btc.address;
            for (let i = 0; i < KEEPER_NUMBER; i++) {
                await expect(registry.connect(users[i]).addKeeper(asset, btcAmount))
                    .to.emit(registry, "KeeperAdded")
                    .withArgs(users[i].address, asset, keeperAmountIn18Decimal);
            }
        });

        it("check CToken amount", async function () {
            for (let i = 0; i < KEEPER_NUMBER; i++) {
                expect(await registry.balanceOf(users[i].address)).to.equal(
                    keeperAmountIn18Decimal
                );
            }
        });

        it("delete keeper with fee", async function () {
            const keeper = group1Keepers[0];
            const keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.refCount).to.equal(0);

            const feeBps = await registry.earlyExitFeeBps();
            const amount = keeperAmountIn18Decimal.mul(10000 - feeBps).div(10000);
            const refundAmount = btcAmount.mul(10000 - feeBps).div(10000);
            await expect(registry.connect(keeper).deleteKeeper(keeperData.amount))
                .to.emit(registry, "KeeperDeleted")
                .withArgs(keeper.address, btc.address, amount, keeperData.amount)
                .to.emit(btc, "Transfer")
                .withArgs(registry.address, keeper.address, refundAmount);

            // CToken
            expect(await registry.balanceOf(keeper.address)).to.equal(0);
        });

        it("delete keeper with updated fee", async function () {
            const keeper = group1Keepers[0];
            const keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.refCount).to.equal(0);

            const feeBps = 10;
            await registry.updateEarlyExitFeeBps(feeBps);
            expect(await registry.earlyExitFeeBps()).to.equal(feeBps);

            const amount = keeperAmountIn18Decimal.mul(10000 - feeBps).div(10000);
            const refundAmount = btcAmount.mul(10000 - feeBps).div(10000);
            await expect(registry.connect(keeper).deleteKeeper(keeperData.amount))
                .to.emit(registry, "KeeperDeleted")
                .withArgs(keeper.address, btc.address, amount, keeperData.amount)
                .to.emit(btc, "Transfer")
                .withArgs(registry.address, keeper.address, refundAmount);
        });

        it("delete keeper without fee", async function () {
            const keeper = group1Keepers[0];
            const keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.refCount).to.equal(0);

            const minKeeperPeriod = await registry.MIN_KEEPER_PERIOD();
            await advanceTimeAndBlock(minKeeperPeriod);

            const origAmount = await btc.balanceOf(keeper.address);

            await expect(registry.connect(keeper).deleteKeeper(keeperData.amount))
                .to.emit(registry, "KeeperDeleted")
                .withArgs(keeper.address, btc.address, keeperAmountIn18Decimal, keeperData.amount)
                .to.emit(btc, "Transfer")
                .withArgs(registry.address, keeper.address, btcAmount);

            expect(await btc.balanceOf(keeper.address)).to.equal(origAmount.add(btcAmount));
        });

        it("delete keeper twice", async function () {
            const keeper = group1Keepers[0];
            let keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.refCount).to.equal(0);

            const minKeeperPeriod = await registry.MIN_KEEPER_PERIOD();
            await advanceTimeAndBlock(minKeeperPeriod);

            const origAmount = await btc.balanceOf(keeper.address);
            const firstDeleteAmount = keeperData.amount.div(2);

            await expect(registry.connect(keeper).deleteKeeper(firstDeleteAmount))
                .to.emit(registry, "KeeperDeleted")
                .withArgs(
                    keeper.address,
                    btc.address,
                    keeperAmountIn18Decimal.div(2),
                    firstDeleteAmount
                )
                .to.emit(btc, "Transfer")
                .withArgs(registry.address, keeper.address, btcAmount.div(2));

            const secondDeleteAmount = keeperData.amount.sub(firstDeleteAmount);
            await expect(registry.connect(keeper).deleteKeeper(secondDeleteAmount))
                .to.emit(registry, "KeeperDeleted")
                .withArgs(
                    keeper.address,
                    btc.address,
                    keeperAmountIn18Decimal.div(2),
                    secondDeleteAmount
                )
                .to.emit(btc, "Transfer")
                .withArgs(registry.address, keeper.address, btcAmount.div(2));

            expect(await btc.balanceOf(keeper.address)).to.equal(origAmount.add(btcAmount));
            keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.amount).to.equal(0);
            expect(keeperData.joinTimestamp).to.equal(0);
        });

        it("add & delete group before delete keeper", async function () {
            expect((await registry.getKeeper(group1Keepers[0].address)).refCount).to.equal(0);
            const counter = new Map();
            await system.connect(deployer).addGroup(
                BTC_ADDRESS[0],
                3,
                GROUP_SATOSHI,
                group1Keepers.map((x) => x.address)
            );
            for (const keeper of group1Keepers) {
                counter.set(keeper.address, 1);
                const keeperData = await registry.getKeeper(keeper.address);
                expect(keeperData.refCount).to.be.equal(1);
            }

            await expect(
                registry.connect(group1Keepers[0]).deleteKeeper(keeperAmountIn18Decimal)
            ).to.revertedWith("ref count > 0");

            // add another group
            await system.connect(deployer).addGroup(
                BTC_ADDRESS[1],
                3,
                GROUP_SATOSHI,
                group2Keepers.map((x) => x.address)
            );
            for (const keeper of group2Keepers) {
                counter.set(keeper.address, (counter.get(keeper.address) || 0) + 1);
            }
            for (let i = 0; i < 6; i++) {
                const keeperData = await registry.getKeeper(users[i].address);
                expect(keeperData.refCount).to.be.equal(counter.get(users[i].address));
            }
        });
    });

    describe("KeeperSwapAsset()", function () {
        const keeperBtcAmount = "0.5";
        const keeperAmountIn18Decimal = parseEther(keeperBtcAmount);
        const satsAmount = parseBtcInSats(keeperBtcAmount);
        let btcAmount: BigNumber;
        let keeper: SignerWithAddress;

        beforeEach(async function () {
            keeper = users[0];
            btcAmount = parseBtc(keeperBtcAmount);

            await registry.connect(deployer).addAsset(sats.address);
            await rater.connect(deployer).updateRates(sats.address, BTC_TO_SATS);

            await expect(registry.connect(keeper).addKeeper(btc.address, btcAmount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, btc.address, keeperAmountIn18Decimal);
        });

        it("swap btc with sats", async function () {
            const origWbtcAmount = await btc.balanceOf(keeper.address);
            const origSatsAmount = await sats.balanceOf(keeper.address);

            // no fee after min keeper period
            const minKeeperPeriod = await registry.MIN_KEEPER_PERIOD();
            await advanceTimeAndBlock(minKeeperPeriod);

            let keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.asset).to.equal(btc.address);
            expect(keeperData.amount).to.equal(keeperAmountIn18Decimal);

            await expect(registry.connect(keeper).swapAsset(sats.address, satsAmount))
                .to.emit(registry, "KeeperAssetSwapped")
                .withArgs(keeper.address, sats.address, satsAmount)
                .to.emit(sats, "Transfer")
                .withArgs(keeper.address, registry.address, satsAmount)
                .to.emit(btc, "Transfer")
                .withArgs(registry.address, keeper.address, btcAmount);

            keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.asset).to.equal(sats.address);
            expect(keeperData.amount).to.equal(keeperAmountIn18Decimal);
            expect(keeperData.joinTimestamp).to.equal(await currentTime());

            expect(await btc.balanceOf(keeper.address)).to.equal(origWbtcAmount.add(btcAmount));
            expect(await sats.balanceOf(keeper.address)).to.equal(origSatsAmount.sub(satsAmount));
        });

        it("non-exist user", async function () {
            await expect(
                registry.connect(users[1]).swapAsset(sats.address, satsAmount)
            ).to.revertedWith("keeper not exist");
        });

        it("same asset", async function () {
            await expect(
                registry.connect(keeper).swapAsset(btc.address, btcAmount)
            ).to.revertedWith("same asset");
        });

        it("not enough allowance", async function () {
            await sats.connect(keeper).approve(registry.address, 0);
            await expect(
                registry.connect(keeper).swapAsset(sats.address, satsAmount)
            ).to.revertedWith("ERC20: insufficient allowance");
        });

        it("not enough balance", async function () {
            await sats
                .connect(keeper)
                .transfer(users[1].address, await sats.balanceOf(keeper.address));
            await expect(
                registry.connect(keeper).swapAsset(sats.address, satsAmount)
            ).to.revertedWith("ERC20: transfer amount exceeds balance");
        });

        it("swap with less amount", async function () {
            await expect(
                registry.connect(keeper).swapAsset(sats.address, satsAmount.div(2))
            ).to.revertedWith("cannot reduce amount");
        });
    });

    describe("punishKeeper()", function () {
        beforeEach(async function () {
            await registry.connect(deployer).addAsset(sats.address);
            await rater.connect(deployer).updateRates(sats.address, BTC_TO_SATS);
        });

        it("should punish keepers using different assets", async function () {
            await registry.connect(users[0]).addKeeper(sats.address, parseBtcInSats("10"));
            await registry.connect(users[1]).addKeeper(btc.address, parseBtc("10"));
            await registry.connect(users[2]).addKeeper(hbtc.address, parseEther("10"));

            const collateral = parseEther("10");
            let user0Data = await registry.getKeeper(users[0].address);
            let user1Data = await registry.getKeeper(users[1].address);
            let user2Data = await registry.getKeeper(users[2].address);

            expect(user0Data.asset).to.equal(sats.address);
            expect(user0Data.amount).to.equal(collateral);
            expect(user1Data.asset).to.equal(btc.address);
            expect(user1Data.amount).to.equal(collateral);
            expect(user2Data.asset).to.equal(hbtc.address);
            expect(user2Data.amount).to.equal(collateral);

            expect(await registry.confiscations(sats.address)).to.be.equal(0);
            expect(await registry.confiscations(btc.address)).to.be.equal(0);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await expect(
                registry
                    .connect(deployer)
                    .punishKeeper([users[0].address, users[1].address, users[2].address])
            )
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, sats.address, collateral)
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[1].address, btc.address, collateral)
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[2].address, hbtc.address, collateral);

            user0Data = await registry.getKeeper(users[0].address);
            user1Data = await registry.getKeeper(users[1].address);
            user2Data = await registry.getKeeper(users[2].address);

            expect(user0Data.asset).to.equal(sats.address);
            expect(user0Data.amount).to.equal(0);
            expect(user1Data.asset).to.equal(btc.address);
            expect(user1Data.amount).to.equal(0);
            expect(user2Data.asset).to.equal(hbtc.address);
            expect(user2Data.amount).to.equal(0);

            expect(await registry.confiscations(sats.address)).to.be.equal(collateral);
            expect(await registry.confiscations(btc.address)).to.be.equal(collateral);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(collateral);
        });
    });

    describe("addConfiscation()", function () {
        it("should not be called if liquidation not up yet", async function () {
            await expect(
                registry.addConfiscation(users[0].address, sats.address, 10)
            ).to.revertedWith("caller contract not up yet");
        });
        it("should not be called if caller is not liquidation", async function () {
            await deployments.deploy("Liquidation", {
                from: deployer.address,
                args: [sats.address, rater.address, registry.address, await currentTime(), 1728000],
            });
            const liquidation = (await ethers.getContract("Liquidation")) as Liquidation;
            await expect(registry.connect(deployer).updateLiquidation(liquidation.address))
                .to.emit(registry, "LiquidationUpdated")
                .withArgs(constants.AddressZero, liquidation.address);
            expect(await registry.liquidation()).to.equal(liquidation.address);
            await expect(
                registry.addConfiscation(users[0].address, sats.address, 10)
            ).to.revertedWith("only liquidation can call");
        });
    });

    describe("addOverissue()", function () {
        it("should not add if amount is 0", async function () {
            await expect(registry.connect(deployer).addOverissue(0)).to.revertedWith(
                "zero overissued amount"
            );
        });

        it("should add overissue", async function () {
            expect(await registry.overissuedTotal()).to.equal(0);

            let overissuedAmount = parseBtcInSats("7");
            await expect(registry.connect(deployer).addOverissue(overissuedAmount))
                .to.emit(registry, "OverissueAdded")
                .withArgs(parseBtcInSats("7"), overissuedAmount);

            expect(await registry.overissuedTotal()).to.equal(parseBtcInSats("7"));

            overissuedAmount = parseBtcInSats("5");
            await expect(registry.connect(deployer).addOverissue(overissuedAmount))
                .to.emit(registry, "OverissueAdded")
                .withArgs(parseBtcInSats("12"), overissuedAmount);

            expect(await registry.overissuedTotal()).to.equal(parseBtcInSats("12"));
        });
    });

    describe("offsetOverissue()", function () {
        beforeEach(async function () {
            await registry.connect(deployer).addAsset(sats.address);
            await rater.connect(deployer).updateRates(sats.address, BTC_TO_SATS);
        });

        it("should offet overissue", async function () {
            //punish keeper
            await registry.connect(users[0]).addKeeper(sats.address, parseBtcInSats("10"));
            await registry.connect(users[1]).addKeeper(sats.address, parseBtcInSats("10"));

            expect(await sats.balanceOf(registry.address)).to.equal(parseBtcInSats("20"));
            expect(await registry.confiscations(sats.address)).to.be.equal(0);

            const collateral = parseBtcInSats("10");
            await expect(
                registry.connect(deployer).punishKeeper([users[0].address, users[1].address])
            )
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, sats.address, collateral)
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[1].address, sats.address, collateral);

            //add overissue
            const overissuedAmount = parseBtcInSats("12");
            await expect(registry.connect(deployer).addOverissue(overissuedAmount))
                .to.emit(registry, "OverissueAdded")
                .withArgs(parseBtcInSats("12"), overissuedAmount);

            expect(await sats.balanceOf(registry.address)).to.equal(parseBtcInSats("20"));
            expect(await registry.confiscations(sats.address)).to.be.equal(parseBtcInSats("20"));
            expect(await registry.overissuedTotal()).to.equal(parseBtcInSats("12"));

            //offset overissue
            const satsAmount = parseBtcInSats("12");
            await expect(registry.connect(deployer).offsetOverissue(satsAmount))
                .to.emit(registry, "OffsetOverissued")
                .withArgs(deployer.address, satsAmount, 0);

            expect(await sats.balanceOf(registry.address)).to.equal(parseBtcInSats("8"));
            expect(await registry.confiscations(sats.address)).to.be.equal(parseBtcInSats("8"));
            expect(await registry.overissuedTotal()).to.equal(0);
        });
    });
});
