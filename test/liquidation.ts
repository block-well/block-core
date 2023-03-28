import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, ethers, Wallet, constants } from "ethers";
import { deployments } from "hardhat";
import { BtcRater, ERC20, KeeperRegistry, Liquidation, MockERC20 } from "../build/typechain";
import { advanceTimeAndBlock, currentTime } from "./helper";
import { DAY } from "./time";

const { parseEther, parseUnits } = ethers.utils;
const parseBtcInSats = (value: string) => parseUnits(value, 18);
const PRECISE_UNIT = parseUnits("1", 18);

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture(["TestToken"]);

    const { deployer } = await ethers.getNamedSigners();
    const users = await ethers.getUnnamedSigners();

    const btc = (await ethers.getContract("BTC")) as MockERC20;

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
    const sats = (await ethers.getContract("SATS")) as MockERC20;

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [btc.address, sats.address],
            [1, 1e8],
        ],
    });
    const rater = (await ethers.getContract("BtcRater")) as BtcRater;

    await deployments.deploy("KeeperRegistry", {
        from: deployer.address,
        args: [[btc.address], sats.address, rater.address, 1e14],
    });
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;

    await deployments.deploy("Liquidation", {
        from: deployer.address,
        args: [sats.address, rater.address, registry.address, (await currentTime()) + DAY, 1728000],
    });
    const liquidation = (await ethers.getContract("Liquidation")) as Liquidation;

    const btcDecimals = await btc.decimals();
    for (const user of users) {
        await btc.mint(user.address, parseUnits("100", btcDecimals));
        await sats.connect(deployer).mint(user.address, parseBtcInSats("100"));

        await btc.connect(user).approve(registry.address, parseUnits("100", btcDecimals));
        await sats.connect(user).approve(registry.address, parseBtcInSats("100"));
    }

    return { deployer, users, btc, sats, registry, liquidation, rater };
});

describe("Liquidation", function () {
    let deployer: SignerWithAddress;
    let users: SignerWithAddress[];
    let btc: ERC20;
    let sats: ERC20;
    let registry: KeeperRegistry;
    let liquidation: Liquidation;
    let rater: BtcRater;
    let btcDecimals = 0;

    beforeEach(async function () {
        ({ deployer, users, btc, sats, registry, liquidation, rater } = await setupFixture());
        btcDecimals = await btc.decimals();
    });

    const parseBtc = (value: string) => parseUnits(value, btcDecimals);

    describe("punishKeeper() & confiscate() & assetAuction()", function () {
        it("can not confiscate if liquidation not up yet", async function () {
            await expect(registry.confiscate([btc.address])).to.revertedWith(
                "liquidation not up yet"
            );
        });

        it("should punish keeper, confiscate asset and auction", async function () {
            /* --- punish keeper --- */
            await registry.connect(users[0]).addKeeper(btc.address, parseBtc("10"));

            const collateral = parseEther("10");
            let userData = await registry.getKeeper(users[0].address);
            expect(userData.asset).to.equal(btc.address);
            expect(userData.amount).to.equal(collateral);

            expect(await registry.confiscations(btc.address)).to.equal(0);

            await expect(registry.connect(deployer).punishKeeper([users[0].address]))
                .to.emit(registry, "KeeperPunished")
                .withArgs(users[0].address, btc.address, collateral);

            userData = await registry.getKeeper(users[0].address);
            expect(userData.amount).to.equal(0);

            expect(await registry.confiscations(btc.address)).to.equal(collateral);

            /* --- update liquidation contract address --- */
            await expect(registry.connect(deployer).updateLiquidation(liquidation.address))
                .to.emit(registry, "LiquidationUpdated")
                .withArgs(constants.AddressZero, liquidation.address);
            expect(await registry.liquidation()).to.equal(liquidation.address);

            /* --- confiscate asset to liquidation contract --- */
            expect(await btc.balanceOf(registry.address)).to.equal(parseBtc("10"));
            expect(await btc.balanceOf(liquidation.address)).to.equal(0);

            await expect(registry.confiscate([btc.address]))
                .to.emit(liquidation, "InitialData")
                .withArgs(
                    await liquidation.startTimestamp(),
                    await liquidation.duration(),
                    btc.address,
                    parseBtc("10")
                )
                .to.emit(registry, "Confiscated")
                .withArgs(liquidation.address, btc.address, collateral);

            expect(await btc.balanceOf(registry.address)).to.equal(0);
            expect(await btc.balanceOf(liquidation.address)).to.equal(parseBtc("10"));

            /* --- asset auction --- */
            //contract btc & sats balances now
            const origLiquidationWbtc = await btc.balanceOf(liquidation.address);
            const origRegistrySats = await sats.balanceOf(registry.address);
            expect(origLiquidationWbtc).to.equal(parseBtc("10"));
            expect(origRegistrySats).to.equal(0);

            //users[1] btc & sats balances now
            const origUserWbtc = await btc.balanceOf(users[1].address);
            const origUserSats = await sats.balanceOf(users[1].address);
            expect(origUserWbtc).to.equal(parseBtc("100"));
            expect(origUserSats).to.equal(parseBtcInSats("100"));

            //different time to auction
            const btcAmount = parseBtc("10");

            //1. auction now
            let timestamp = await currentTime();
            let price = await liquidation.discountPrice(timestamp);
            expect(price).to.equal(BigNumber.from("1").mul(PRECISE_UNIT));

            let discountSatsAmount = await liquidation.calcDiscountSatsAmount(
                btc.address,
                btcAmount
            );
            expect(discountSatsAmount).to.equal(parseBtcInSats("10"));

            await expect(
                liquidation.connect(users[1]).assetAuction(btc.address, btcAmount, registry.address)
            ).to.revertedWith("auction not start");

            //2. auction after one day
            await advanceTimeAndBlock(DAY);

            timestamp = await currentTime();
            price = await liquidation.discountPrice(timestamp);
            const duration = BigNumber.from(timestamp).sub(await liquidation.startTimestamp());
            expect(price).to.equal(
                PRECISE_UNIT.sub(duration.mul(PRECISE_UNIT).div(await liquidation.duration()))
            );

            discountSatsAmount = await liquidation.calcDiscountSatsAmount(btc.address, btcAmount);
            expect(discountSatsAmount).to.equal(parseBtcInSats("10").mul(price).div(PRECISE_UNIT));

            //recipient is wrong
            await expect(
                liquidation
                    .connect(users[1])
                    .assetAuction(btc.address, btcAmount, liquidation.address)
            ).to.revertedWith("recipient not match registry");

            //successful auction
            const tx = await liquidation
                .connect(users[1])
                .assetAuction(btc.address, btcAmount, registry.address);
            discountSatsAmount = await liquidation.calcDiscountSatsAmount(btc.address, btcAmount);
            await expect(tx)
                .to.emit(liquidation, "AssetAuctioned")
                .withArgs(users[1].address, btc.address, btcAmount, discountSatsAmount)
                .to.emit(registry, "ConfiscationAdded")
                .withArgs(
                    sats.address,
                    await rater.calcAmountInWei(sats.address, discountSatsAmount)
                );

            //contract btc & sats balances now
            expect(await btc.balanceOf(liquidation.address)).to.equal(
                origLiquidationWbtc.sub(btcAmount)
            );
            expect(await sats.balanceOf(registry.address)).to.equal(
                origRegistrySats.add(discountSatsAmount)
            );

            //users[1] btc & sats balances now
            expect(await btc.balanceOf(users[1].address)).to.equal(origUserWbtc.add(btcAmount));
            expect(await sats.balanceOf(users[1].address)).to.equal(
                origUserSats.sub(discountSatsAmount)
            );

            /* --- offset overissue --- */
            //add overissue
            expect(await registry.overissuedTotal()).to.equal(0);

            const overissuedAmount = parseBtcInSats("5");
            await expect(registry.connect(deployer).addOverissue(overissuedAmount))
                .to.emit(registry, "OverissueAdded")
                .withArgs(parseBtcInSats("5"), overissuedAmount);

            expect(await sats.balanceOf(registry.address)).to.equal(discountSatsAmount);
            expect(await registry.confiscations(sats.address)).to.be.equal(discountSatsAmount);
            expect(await registry.overissuedTotal()).to.equal(parseBtcInSats("5"));

            //offset overissue
            const satsAmount = parseBtcInSats("5");
            await expect(registry.connect(deployer).offsetOverissue(satsAmount))
                .to.emit(registry, "OffsetOverissued")
                .withArgs(deployer.address, satsAmount, 0);

            expect(await sats.balanceOf(registry.address)).to.equal(
                discountSatsAmount.sub(satsAmount)
            );
            expect(await registry.confiscations(sats.address)).to.be.equal(
                discountSatsAmount.sub(satsAmount)
            );
            expect(await registry.overissuedTotal()).to.equal(0);
        });
    });
});
