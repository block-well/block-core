import { expect } from "chai";
import { Wallet, constants } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
import { KeeperRegistry, ERC20, BtcRater, DeCusSystem } from "../build/typechain";
import { advanceTimeAndBlock, currentTime } from "./helper";

const { parseEther, parseUnits } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
const parseBtcInSats = (value: string) => parseUnits(value, 18);
const BTC_TO_SATS = 1e8;

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer

    await deployments.deploy("MockWBTC", {
        from: deployer.address,
        log: true,
    });
    const wbtc = (await ethers.getContract("MockWBTC")) as ERC20;

    await deployments.deploy("SATS", {
        from: deployer.address,
        log: true,
    });
    await deployments.execute(
        "SATS",
        { from: deployer.address, log: true },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        deployer.address
    );
    const sats = (await ethers.getContract("SATS")) as ERC20;

    const dcs = await deployments.deploy("DCS", {
        from: deployer.address,
        log: true,
    });

    await deployments.deploy("MockHBTC", {
        contract: "MockERC20",
        from: deployer.address,
        log: true,
    });
    const hbtc = (await ethers.getContract("MockHBTC")) as ERC20;

    await deployments.deploy("DeCusSystem", {
        from: deployer.address,
        args: [],
        log: true,
    });

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [wbtc.address, hbtc.address],
            [1, 1],
        ],
        log: true,
    });

    const rater = (await ethers.getContract("BtcRater")) as BtcRater;

    await deployments.deploy("KeeperRegistry", {
        from: deployer.address,
        args: [[wbtc.address, hbtc.address], sats.address, rater.address],
        log: true,
    });
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;

    const fee = await deployments.deploy("SwapFee", {
        from: deployer.address,
        args: [0, 20, 50, 11111, sats.address],
        log: true,
    });

    const system = (await ethers.getContract("DeCusSystem")) as DeCusSystem;

    const rewarder = await deployments.deploy("SwapRewarder", {
        from: deployer.address,
        args: [dcs.address, system.address],
        log: true,
    });

    await deployments.execute(
        "DeCusSystem",
        { from: deployer.address, log: true },
        "initialize",
        sats.address,
        registry.address,
        rewarder.address,
        fee.address
    );

    await deployments.execute(
        "KeeperRegistry",
        { from: deployer.address, log: true },
        "setSystem",
        system.address
    );

    for (const user of users) {
        await wbtc.mint(user.address, parseBtc("100"));
        await hbtc.mint(user.address, parseEther("100"));
        await sats.connect(deployer).mint(user.address, parseBtcInSats("100"));

        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await hbtc.connect(user).approve(registry.address, parseEther("100"));
        await sats.connect(user).approve(registry.address, parseBtcInSats("100"));
    }

    return { users, deployer, wbtc, hbtc, sats, registry, rater, system };
});

describe("KeeperRegistry", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let wbtc: ERC20;
    let hbtc: ERC20;
    let sats: ERC20;
    let rater: BtcRater;
    let registry: KeeperRegistry;
    let system: DeCusSystem;

    beforeEach(async function () {
        ({ users, deployer, wbtc, hbtc, sats, registry, rater, system } = await setupFixture());
    });

    describe("addAsset()", function () {
        it("should add asset", async function () {
            const MockWBTC = await ethers.getContractFactory("MockWBTC");
            const wbtc2 = await MockWBTC.connect(deployer).deploy();

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const hbtc2 = await MockERC20.connect(deployer).deploy();

            await expect(registry.connect(deployer).addAsset(wbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(wbtc2.address);

            await expect(registry.connect(deployer).addAsset(hbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(hbtc2.address);
        });
    });

    describe("addKeeper()", function () {
        // it("not enough collateral", async function () {
        //     const btcAmount = "0.00001";
        //     const wbtcAmount = parseBtc(btcAmount);
        //     const asset = wbtc.address;
        //     let keeperData = await registry.getKeeper(users[0].address);
        //     expect(keeperData.asset).to.equal(constants.AddressZero);
        //     expect(keeperData.amount).to.equal(0);
        //     expect(keeperData.refCount).to.equal(0);
        //     expect(keeperData.joinTimestamp).to.equal(0);

        //     const amountIn18Decimal = parseEther(btcAmount);
        //     await expect(registry.connect(users[0]).addKeeper(asset, wbtcAmount))
        //         .to.emit(registry, "KeeperAdded")
        //         .withArgs(users[0].address, asset, wbtcAmount);

        //     keeperData = await registry.getKeeper(users[0].address);
        //     expect(keeperData.asset).to.equal(asset);
        //     expect(keeperData.amount).to.equal(amountIn18Decimal);
        //     expect(keeperData.refCount).to.equal(0);
        //     expect(keeperData.joinTimestamp).to.equal(0);
        // });

        it("should add keeper", async function () {
            const btcAmount = "10";
            const wbtcAmount = parseBtc(btcAmount);
            const asset = wbtc.address;

            let keeperData = await registry.getKeeper(users[0].address);
            expect(keeperData.asset).to.equal(constants.AddressZero);
            expect(keeperData.amount).to.equal(0);
            expect(keeperData.refCount).to.equal(0);
            expect(keeperData.joinTimestamp).to.equal(0);

            expect(await wbtc.balanceOf(users[0].address)).to.be.equal(parseBtc("100"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("0"));
            expect(await hbtc.balanceOf(users[0].address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);

            const amountIn18Decimal = parseEther(btcAmount);
            await expect(registry.connect(users[0]).addKeeper(asset, wbtcAmount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, asset, amountIn18Decimal);

            keeperData = await registry.getKeeper(users[0].address);
            expect(keeperData.asset).to.equal(asset);
            expect(keeperData.amount).to.equal(amountIn18Decimal);
            expect(keeperData.refCount).to.equal(0);
            expect(keeperData.joinTimestamp).to.equal(await currentTime());

            expect(await wbtc.balanceOf(users[0].address)).to.be.equal(parseBtc("90"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("10"));
            expect(await hbtc.balanceOf(users[0].address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);
        });

        it("import keepers", async function () {
            const btcAmount = "10";
            const wbtcAmount = parseBtc(btcAmount);
            const asset = wbtc;
            const keepers = [users[0], users[1]];
            const keeperAddresses = keepers.map((x) => x.address);
            const auction = deployer;
            for (const keeper of keepers) {
                await asset.connect(keeper).transfer(auction.address, wbtcAmount);
            }

            const transferAmount = wbtcAmount.mul(keepers.length);
            await asset.connect(auction).approve(registry.address, transferAmount);
            expect(await asset.balanceOf(auction.address)).to.be.equal(transferAmount);

            const amountIn18Decimal = parseEther(btcAmount);
            await expect(
                registry.connect(auction).importKeepers(wbtcAmount, asset.address, keeperAddresses)
            )
                .to.emit(registry, "KeeperImported")
                .withArgs(auction.address, asset.address, keeperAddresses, amountIn18Decimal);

            expect(await asset.balanceOf(registry.address)).to.be.equal(transferAmount);
            expect(await asset.balanceOf(auction.address)).to.be.equal(0);
            for (const keeper of keepers) {
                const keeperData = await registry.getKeeper(keeper.address);
                expect(keeperData.amount).to.be.equal(amountIn18Decimal);
            }
        });

        it("import keepers hbtc", async function () {
            const amount = parseEther("10");
            const asset = hbtc;
            const keepers = [users[0], users[1]];
            const keeperAddresses = keepers.map((x) => x.address);
            const auction = deployer;
            for (const keeper of keepers) {
                await asset.connect(keeper).transfer(auction.address, amount);
            }

            const transferAmount = amount.mul(keepers.length);
            await asset.connect(auction).approve(registry.address, transferAmount);
            expect(await asset.balanceOf(auction.address)).to.be.equal(transferAmount);

            await expect(
                registry.connect(auction).importKeepers(amount, asset.address, keeperAddresses)
            )
                .to.emit(registry, "KeeperImported")
                .withArgs(auction.address, asset.address, keeperAddresses, amount);

            expect(await asset.balanceOf(registry.address)).to.be.equal(transferAmount);
            expect(await asset.balanceOf(auction.address)).to.be.equal(0);
            for (const keeper of keepers) {
                const keeperData = await registry.getKeeper(keeper.address);
                expect(keeperData.amount).to.be.equal(amount);
            }
        });
    });

    describe("deleteKeeper()", function () {
        const keeperBtcAmount = "0.5";
        const wbtcAmount = parseBtc(keeperBtcAmount);
        const keeperAmountIn18Decimal = parseEther(keeperBtcAmount);
        const GROUP_SATOSHI = parseBtc("0.6");
        const BTC_ADDRESS = [
            "38aNsdfsdfsdfsdfsdfdsfsdf0",
            "38aNsdfsdfsdfsdfsdfdsfsdf1",
            "38aNsdfsdfsdfsdfsdfdsfsdf2",
        ];
        let group1Keepers: Wallet[];
        let group2Keepers: Wallet[];

        beforeEach(async function () {
            await registry.connect(deployer).addAsset(sats.address);
            await rater.connect(deployer).updateRates(sats.address, BTC_TO_SATS);

            group1Keepers = [users[0], users[1], users[2], users[3]];
            group2Keepers = [users[0], users[1], users[4], users[5]];

            const asset = wbtc.address;
            for (let i = 0; i < 6; i++) {
                await expect(registry.connect(users[i]).addKeeper(asset, wbtcAmount))
                    .to.emit(registry, "KeeperAdded")
                    .withArgs(users[i].address, asset, keeperAmountIn18Decimal);
            }
        });

        it("delete keeper when no ref with fee", async function () {
            const keeper = group1Keepers[0];
            const keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.refCount).to.equal(0);

            const feeBps = await registry.earlyExitFeeBps();
            const amount = keeperAmountIn18Decimal.mul(10000 - feeBps).div(10000);
            const refundAmount = wbtcAmount.mul(10000 - feeBps).div(10000);
            await expect(registry.connect(keeper).deleteKeeper())
                .to.emit(registry, "KeeperDeleted")
                .withArgs(keeper.address, wbtc.address, amount)
                .to.emit(wbtc, "Transfer")
                .withArgs(registry.address, keeper.address, refundAmount);
        });

        it("delete keeper with updated fee", async function () {
            const keeper = group1Keepers[0];
            const keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.refCount).to.equal(0);

            const feeBps = 10;
            await registry.updateEarlyExitFeeBps(feeBps);
            expect(await registry.earlyExitFeeBps()).to.equal(feeBps);

            const amount = keeperAmountIn18Decimal.mul(10000 - feeBps).div(10000);
            const refundAmount = wbtcAmount.mul(10000 - feeBps).div(10000);
            await expect(registry.connect(keeper).deleteKeeper())
                .to.emit(registry, "KeeperDeleted")
                .withArgs(keeper.address, wbtc.address, amount)
                .to.emit(wbtc, "Transfer")
                .withArgs(registry.address, keeper.address, refundAmount);
        });

        it("delete keeper when no ref without fee", async function () {
            const keeper = group1Keepers[0];
            const keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.refCount).to.equal(0);

            const minKeeperPeriod = await registry.MIN_KEEPER_PERIOD();
            await advanceTimeAndBlock(minKeeperPeriod);

            const origAmount = await wbtc.balanceOf(keeper.address);

            await expect(registry.connect(keeper).deleteKeeper())
                .to.emit(registry, "KeeperDeleted")
                .withArgs(keeper.address, wbtc.address, keeperAmountIn18Decimal)
                .to.emit(wbtc, "Transfer")
                .withArgs(registry.address, keeper.address, wbtcAmount);

            expect(await wbtc.balanceOf(keeper.address)).to.equal(origAmount.add(wbtcAmount));
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

            await expect(registry.connect(group1Keepers[0]).deleteKeeper()).to.revertedWith(
                "ref count > 0"
            );

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
        const wbtcAmount = parseBtc(keeperBtcAmount);
        const keeperAmountIn18Decimal = parseEther(keeperBtcAmount);
        const satsAmount = parseBtcInSats(keeperBtcAmount);
        let keeper: Wallet;

        beforeEach(async function () {
            keeper = users[0];

            await registry.connect(deployer).addAsset(sats.address);
            await rater.connect(deployer).updateRates(sats.address, BTC_TO_SATS);

            await expect(registry.connect(keeper).addKeeper(wbtc.address, wbtcAmount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, wbtc.address, keeperAmountIn18Decimal);
        });

        it("swap wbtc with sats", async function () {
            const origWbtcAmount = await wbtc.balanceOf(keeper.address);
            const origSatsAmount = await sats.balanceOf(keeper.address);

            // no fee after min keeper period
            const minKeeperPeriod = await registry.MIN_KEEPER_PERIOD();
            await advanceTimeAndBlock(minKeeperPeriod);

            let keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.asset).to.equal(wbtc.address);
            expect(keeperData.amount).to.equal(keeperAmountIn18Decimal);

            await expect(registry.connect(keeper).swapAsset(sats.address, satsAmount))
                .to.emit(registry, "KeeperAssetSwapped")
                .withArgs(keeper.address, sats.address, satsAmount)
                .to.emit(sats, "Transfer")
                .withArgs(keeper.address, registry.address, satsAmount)
                .to.emit(wbtc, "Transfer")
                .withArgs(registry.address, keeper.address, wbtcAmount);

            keeperData = await registry.getKeeper(keeper.address);
            expect(keeperData.asset).to.equal(sats.address);
            expect(keeperData.amount).to.equal(keeperAmountIn18Decimal);
            expect(keeperData.joinTimestamp).to.equal(await currentTime());

            expect(await wbtc.balanceOf(keeper.address)).to.equal(origWbtcAmount.add(wbtcAmount));
            expect(await sats.balanceOf(keeper.address)).to.equal(origSatsAmount.sub(satsAmount));
        });

        it("non-exist user", async function () {
            await expect(
                registry.connect(users[1]).swapAsset(sats.address, satsAmount)
            ).to.revertedWith("keeper not exist");
        });

        it("same asset", async function () {
            await expect(
                registry.connect(keeper).swapAsset(wbtc.address, wbtcAmount)
            ).to.revertedWith("same asset");
        });

        it("not enough allowance", async function () {
            await sats.connect(keeper).approve(registry.address, 0);
            await expect(
                registry.connect(keeper).swapAsset(sats.address, satsAmount)
            ).to.revertedWith("ERC20: transfer amount exceeds allowance");
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

        it("should punish keeper using non-SATS assets", async function () {
            await registry.connect(users[0]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[1]).addKeeper(hbtc.address, parseEther("10"));

            const collateral = parseEther("10");
            let user0Data = await registry.getKeeper(users[0].address);
            let user1Data = await registry.getKeeper(users[1].address);
            expect(user0Data.asset).to.equal(wbtc.address);
            expect(user0Data.amount).to.equal(collateral);
            expect(user1Data.asset).to.equal(hbtc.address);
            expect(user1Data.amount).to.equal(collateral);

            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(0);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await expect(registry.connect(deployer).punishKeeper([users[0].address]))
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, wbtc.address, collateral);

            const overissued = parseEther("7");
            await expect(registry.connect(deployer).addOverissue(overissued))
                .to.emit(registry, "OverissueAdded")
                .withArgs(overissued, overissued, 0);

            user0Data = await registry.getKeeper(users[0].address);
            user1Data = await registry.getKeeper(users[1].address);
            expect(user0Data.amount).to.equal(0);
            expect(user1Data.amount).to.equal(collateral);

            expect(await registry.overissuedTotal()).to.be.equal(overissued);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(collateral);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await expect(registry.connect(deployer).punishKeeper([users[1].address]))
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[1].address, hbtc.address, collateral);
            const overissued2 = parseEther("5");
            const overissuedTotal = overissued.add(overissued2);
            await expect(registry.connect(deployer).addOverissue(overissued2))
                .to.emit(registry, "OverissueAdded")
                .withArgs(overissuedTotal, overissued2, 0);

            user0Data = await registry.getKeeper(users[0].address);
            user1Data = await registry.getKeeper(users[1].address);
            expect(user0Data.amount).to.equal(0);
            expect(user1Data.amount).to.equal(0);

            expect(await registry.overissuedTotal()).to.be.equal(overissuedTotal);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(collateral);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(collateral);
        });

        it("should punish sats keeper and confiscate the rest", async function () {
            const collateral = parseBtcInSats("10");

            await expect(registry.connect(users[0]).addKeeper(sats.address, collateral))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, sats.address, collateral);

            const overissued = parseEther("7");
            await expect(registry.connect(deployer).punishKeeper([users[0].address]))
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, sats.address, collateral);

            await expect(registry.connect(deployer).addOverissue(overissued))
                .to.emit(registry, "OverissueAdded")
                .withArgs(0, 0, overissued);

            const keeperData = await registry.getKeeper(users[0].address);
            expect(keeperData.asset).to.equal(sats.address);
            expect(keeperData.amount).to.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(sats.address)).to.be.equal(
                collateral.sub(overissued)
            );
        });

        it("should punish sats keeper and record the rest as overissues", async function () {
            const collateral = parseBtcInSats("10");
            await registry.connect(users[0]).addKeeper(sats.address, collateral);

            await expect(registry.connect(deployer).punishKeeper([users[0].address]))
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, sats.address, collateral);

            const overissued = parseEther("12");
            const remainOverissued = overissued.sub(collateral);
            await expect(registry.connect(deployer).addOverissue(overissued))
                .to.emit(registry, "OverissueAdded")
                .withArgs(remainOverissued, remainOverissued, collateral);

            const keeperData = await registry.getKeeper(users[0].address);
            expect(keeperData.asset).to.equal(sats.address);
            expect(keeperData.amount).to.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(remainOverissued);
            expect(await registry.confiscations(sats.address)).to.be.equal(0);

            const satsAmount = parseBtcInSats("1.5");
            const leftAmount = remainOverissued.sub(satsAmount);
            await expect(registry.connect(users[3]).offsetOverissue(satsAmount))
                .to.emit(registry, "OffsetOverissued")
                .withArgs(users[3].address, satsAmount, leftAmount);
            expect(await registry.overissuedTotal()).to.be.equal(leftAmount);
        });

        it("should punish sats & non-sats keepers and confiscate the rest", async function () {
            await registry.connect(users[0]).addKeeper(sats.address, parseBtcInSats("10"));
            await registry.connect(users[1]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[2]).addKeeper(sats.address, parseBtcInSats("10"));
            const collateral = parseBtcInSats("10");

            await expect(
                registry
                    .connect(deployer)
                    .punishKeeper([users[0].address, users[1].address, users[2].address])
            )
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, sats.address, collateral)
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[1].address, wbtc.address, collateral);

            const overissued = parseEther("9");
            await expect(registry.connect(deployer).addOverissue(overissued))
                .to.emit(registry, "OverissueAdded")
                .withArgs(0, 0, overissued);

            const keeper0Data = await registry.getKeeper(users[0].address);
            expect(keeper0Data.asset).to.equal(sats.address);
            expect(keeper0Data.amount).to.equal(0);

            const keeper1Data = await registry.getKeeper(users[1].address);
            expect(keeper1Data.asset).to.equal(wbtc.address);
            expect(keeper1Data.amount).to.equal(0);

            const keeper2Data = await registry.getKeeper(users[2].address);
            expect(keeper2Data.asset).to.equal(sats.address);
            expect(keeper2Data.amount).to.equal(0);

            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(sats.address)).to.be.equal(parseEther("11"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
        });

        it("should punish sats & non-sats keepers and record the rest as overissues", async function () {
            await registry.connect(users[0]).addKeeper(sats.address, parseBtcInSats("10"));
            await registry.connect(users[1]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[2]).addKeeper(sats.address, parseBtcInSats("10"));
            const collateral = parseBtcInSats("10");

            await expect(
                registry
                    .connect(deployer)
                    .punishKeeper([users[0].address, users[1].address, users[2].address])
            )
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, sats.address, collateral)
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[1].address, wbtc.address, collateral);

            const overissued = parseEther("21");
            const remainOverissued = overissued.sub(collateral.mul(2));
            await expect(registry.connect(deployer).addOverissue(overissued))
                .to.emit(registry, "OverissueAdded")
                .withArgs(remainOverissued, remainOverissued, collateral.mul(2));

            const keeper0Data = await registry.getKeeper(users[0].address);
            expect(keeper0Data.asset).to.equal(sats.address);
            expect(keeper0Data.amount).to.equal(0);

            const keeper1Data = await registry.getKeeper(users[1].address);
            expect(keeper1Data.asset).to.equal(wbtc.address);
            expect(keeper1Data.amount).to.equal(0);

            const keeper2Data = await registry.getKeeper(users[2].address);
            expect(keeper2Data.asset).to.equal(sats.address);
            expect(keeper2Data.amount).to.equal(0);

            expect(await registry.overissuedTotal()).to.be.equal(remainOverissued);
            expect(await registry.confiscations(sats.address)).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(collateral);
        });
    });
});
