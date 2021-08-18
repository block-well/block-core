import { expect } from "chai";
import { BigNumber, ethers, Wallet, constants } from "ethers";
import { deployments, waffle } from "hardhat";
import { BtcRater, ERC20, KeeperRegistry, Liquidation } from "../build/typechain";
import { advanceTimeAndBlock, currentTime, DAY } from "./helper";

const { parseEther, parseUnits } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
const parseBtcInSats = (value: string) => parseUnits(value, 18);
const PRECISE_UNIT = parseUnits("1", 18);

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture([]);

    const [deployer, ...users] = waffle.provider.getWallets();

    await deployments.deploy("MockWBTC", {
        from: deployer.address,
    });
    const wbtc = (await ethers.getContract("MockWBTC")) as ERC20;

    await deployments.deploy("MockHBTC", {
        contract: "MockERC20",
        from: deployer.address,
    });
    const hbtc = (await ethers.getContract("MockHBTC")) as ERC20;

    await deployments.deploy("SATS", {
        from: deployer.address,
    });
    await deployments.execute(
        "SATS",
        { from: deployer.address },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        deployer.address
    );
    const sats = (await ethers.getContract("SATS")) as ERC20;

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [wbtc.address, hbtc.address, sats.address],
            [1, 1, 1e8],
        ],
    });
    const rater = (await ethers.getContract("BtcRater")) as BtcRater;

    await deployments.deploy("KeeperRegistry", {
        from: deployer.address,
        args: [[wbtc.address, hbtc.address], sats.address, rater.address],
    });
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;

    await deployments.deploy("Liquidation", {
        from: deployer.address,
        args: [sats.address, rater.address, registry.address, (await currentTime()) + DAY, 1728000],
    });
    const liquidation = (await ethers.getContract("Liquidation")) as Liquidation;

    for (const user of users) {
        await wbtc.mint(user.address, parseBtc("100"));
        await sats.connect(deployer).mint(user.address, parseBtcInSats("100"));

        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await sats.connect(user).approve(liquidation.address, parseBtcInSats("100"));
    }

    return { deployer, users, wbtc, sats, registry, liquidation };
});

describe("Liquidation", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let wbtc: ERC20;
    let sats: ERC20;
    let registry: KeeperRegistry;
    let liquidation: Liquidation;

    beforeEach(async function () {
        ({ deployer, users, wbtc, sats, registry, liquidation } = await setupFixture());
    });

    describe("punishKeeper() & confiscate() & assetAuction()", function () {
        it("can not confiscate if liquidation not up yet", async function () {
            await expect(registry.confiscate([wbtc.address])).to.revertedWith(
                "liquidation not up yet"
            );
        });

        it("should punish keeper, confiscate asset and auction", async function () {
            /* --- punish keeper --- */
            await registry.connect(users[0]).addKeeper(wbtc.address, parseBtc("10"));

            const collateral = parseEther("10");
            let userData = await registry.getKeeper(users[0].address);
            expect(userData.asset).to.equal(wbtc.address);
            expect(userData.amount).to.equal(collateral);

            expect(await registry.confiscations(wbtc.address)).to.equal(0);

            await expect(registry.connect(deployer).punishKeeper([users[0].address]))
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, wbtc.address, collateral);

            userData = await registry.getKeeper(users[0].address);
            expect(userData.amount).to.equal(0);

            expect(await registry.confiscations(wbtc.address)).to.equal(collateral);

            /* --- update liquidation contract address --- */
            await expect(registry.connect(deployer).updateLiquidation(liquidation.address))
                .to.emit(registry, "LiquidationUpdated")
                .withArgs(constants.AddressZero, liquidation.address);
            expect(await registry.liquidation()).to.equal(liquidation.address);

            /* --- confiscate asset to liquidation contract --- */
            expect(await wbtc.balanceOf(registry.address)).to.equal(parseBtc("10"));
            expect(await wbtc.balanceOf(liquidation.address)).to.equal(0);

            await expect(registry.confiscate([wbtc.address]))
                .to.emit(liquidation, "InitialData")
                .withArgs(
                    await liquidation.startTimestamp(),
                    await liquidation.duration(),
                    wbtc.address,
                    parseBtc("10")
                )
                .to.emit(registry, "Confiscated")
                .withArgs(liquidation.address, wbtc.address, collateral);

            expect(await wbtc.balanceOf(registry.address)).to.equal(0);
            expect(await wbtc.balanceOf(liquidation.address)).to.equal(parseBtc("10"));

            /* --- asset auction --- */
            //contract wbtc & sats balances now
            const origLiquidationWbtc = await wbtc.balanceOf(liquidation.address);
            const origRegistrySats = await sats.balanceOf(registry.address);
            expect(origLiquidationWbtc).to.equal(parseBtc("10"));
            expect(origRegistrySats).to.equal(0);

            //users[1] wbtc & sats balances now
            const origUserWbtc = await wbtc.balanceOf(users[1].address);
            const origUserSats = await sats.balanceOf(users[1].address);
            expect(origUserWbtc).to.equal(parseBtc("100"));
            expect(origUserSats).to.equal(parseBtcInSats("100"));

            //different time to auction
            const wbtcAmount = parseBtc("10");

            //1. auction now
            let timestamp = await currentTime();
            let price = await liquidation.discountPrice(timestamp);
            expect(price).to.equal(BigNumber.from("1").mul(PRECISE_UNIT));

            let discountSatsAmount = await liquidation.calcDiscountSatsAmount(
                wbtc.address,
                wbtcAmount
            );
            expect(discountSatsAmount).to.equal(parseBtcInSats("10"));

            await expect(
                liquidation.connect(users[1]).assetAuction(wbtc.address, wbtcAmount)
            ).to.revertedWith("auction not start");

            //2. auction after one day
            await advanceTimeAndBlock(DAY);

            timestamp = await currentTime();
            price = await liquidation.discountPrice(timestamp);
            const duration = BigNumber.from(timestamp).sub(await liquidation.startTimestamp());
            expect(price).to.equal(
                PRECISE_UNIT.sub(duration.mul(PRECISE_UNIT).div(await liquidation.duration()))
            );

            discountSatsAmount = await liquidation.calcDiscountSatsAmount(wbtc.address, wbtcAmount);
            expect(discountSatsAmount).to.equal(parseBtcInSats("10").mul(price).div(PRECISE_UNIT));

            const tx = await liquidation.connect(users[1]).assetAuction(wbtc.address, wbtcAmount);
            discountSatsAmount = await liquidation.calcDiscountSatsAmount(wbtc.address, wbtcAmount);
            await expect(tx)
                .to.emit(liquidation, "AssetAuctioned")
                .withArgs(users[1].address, wbtc.address, wbtcAmount, discountSatsAmount);

            //contract wbtc & sats balances now
            expect(await wbtc.balanceOf(liquidation.address)).to.equal(
                origLiquidationWbtc.sub(wbtcAmount)
            );
            expect(await sats.balanceOf(registry.address)).to.equal(
                origRegistrySats.add(discountSatsAmount)
            );

            //users[1] wbtc & sats balances now
            expect(await wbtc.balanceOf(users[1].address)).to.equal(origUserWbtc.add(wbtcAmount));
            expect(await sats.balanceOf(users[1].address)).to.equal(
                origUserSats.sub(discountSatsAmount)
            );
        });
    });
});
