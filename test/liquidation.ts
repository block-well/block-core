import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, constants, ethers } from "ethers";
import { deployments } from "hardhat";
import { BtcRater, ERC20, KeeperRegistry, Liquidation, MockERC20 } from "../build/typechain";
import { advanceTimeAndBlock, currentTime } from "./helper";
import { DAY } from "./time";

const { parseEther, parseUnits } = ethers.utils;
const parseBtcInEbtc = (value: string) => parseUnits(value, 18);
const PRECISE_UNIT = parseUnits("1", 18);

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture(["TestToken"]);

    const { deployer } = await ethers.getNamedSigners();
    const users = await ethers.getUnnamedSigners();

    const btc = (await ethers.getContract("BTC")) as MockERC20;

    await deployments.deploy("EBTC", {
        from: deployer.address,
    });
    await deployments.execute(
        "EBTC",
        { from: deployer.address },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        deployer.address
    );
    const ebtc = (await ethers.getContract("EBTC")) as MockERC20;

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [btc.address, ebtc.address],
            [1, 1],
        ],
    });
    const rater = (await ethers.getContract("BtcRater")) as BtcRater;

    await deployments.deploy("KeeperRegistry", {
        from: deployer.address,
        args: [[btc.address], ebtc.address, rater.address, 1e14],
    });
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;

    await deployments.deploy("Liquidation", {
        from: deployer.address,
        args: [ebtc.address, rater.address, registry.address, (await currentTime()) + DAY, 1728000],
    });
    const liquidation = (await ethers.getContract("Liquidation")) as Liquidation;

    const btcDecimals = await btc.decimals();
    for (const user of users) {
        await btc.mint(user.address, parseUnits("100", btcDecimals));
        await ebtc.connect(deployer).mint(user.address, parseBtcInEbtc("100"));

        await btc.connect(user).approve(registry.address, parseUnits("100", btcDecimals));
        await ebtc.connect(user).approve(registry.address, parseBtcInEbtc("100"));
    }

    return { deployer, users, btc, ebtc, registry, liquidation, rater };
});

describe("Liquidation", function () {
    let deployer: SignerWithAddress;
    let users: SignerWithAddress[];
    let btc: ERC20;
    let ebtc: ERC20;
    let registry: KeeperRegistry;
    let liquidation: Liquidation;
    let rater: BtcRater;
    let btcDecimals = 0;

    beforeEach(async function () {
        ({ deployer, users, btc, ebtc, registry, liquidation, rater } = await setupFixture());
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
            //contract btc & ebtc balances now
            const origLiquidationWbtc = await btc.balanceOf(liquidation.address);
            const origRegistryEbtc = await ebtc.balanceOf(registry.address);
            expect(origLiquidationWbtc).to.equal(parseBtc("10"));
            expect(origRegistryEbtc).to.equal(0);

            //users[1] btc & ebtc balances now
            const origUserWbtc = await btc.balanceOf(users[1].address);
            const origUserEbtc = await ebtc.balanceOf(users[1].address);
            expect(origUserWbtc).to.equal(parseBtc("100"));
            expect(origUserEbtc).to.equal(parseBtcInEbtc("100"));

            //different time to auction
            const btcAmount = parseBtc("10");

            //1. auction now
            let timestamp = await currentTime();
            let price = await liquidation.discountPrice(timestamp);
            expect(price).to.equal(BigNumber.from("1").mul(PRECISE_UNIT));

            let discountEbtcAmount = await liquidation.calcDiscountEbtcAmount(
                btc.address,
                btcAmount
            );
            expect(discountEbtcAmount).to.equal(parseBtcInEbtc("10"));

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

            discountEbtcAmount = await liquidation.calcDiscountEbtcAmount(btc.address, btcAmount);
            expect(discountEbtcAmount).to.equal(parseBtcInEbtc("10").mul(price).div(PRECISE_UNIT));

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
            discountEbtcAmount = await liquidation.calcDiscountEbtcAmount(btc.address, btcAmount);
            await expect(tx)
                .to.emit(liquidation, "AssetAuctioned")
                .withArgs(users[1].address, btc.address, btcAmount, discountEbtcAmount)
                .to.emit(registry, "ConfiscationAdded")
                .withArgs(
                    ebtc.address,
                    await rater.calcAmountInWei(ebtc.address, discountEbtcAmount)
                );

            //contract btc & ebtc balances now
            expect(await btc.balanceOf(liquidation.address)).to.equal(
                origLiquidationWbtc.sub(btcAmount)
            );
            expect(await ebtc.balanceOf(registry.address)).to.equal(
                origRegistryEbtc.add(discountEbtcAmount)
            );

            //users[1] btc & ebtc balances now
            expect(await btc.balanceOf(users[1].address)).to.equal(origUserWbtc.add(btcAmount));
            expect(await ebtc.balanceOf(users[1].address)).to.equal(
                origUserEbtc.sub(discountEbtcAmount)
            );

            /* --- offset overissue --- */
            //add overissue
            expect(await registry.overissuedTotal()).to.equal(0);

            const overissuedAmount = parseBtcInEbtc("5");
            await expect(registry.connect(deployer).addOverissue(overissuedAmount))
                .to.emit(registry, "OverissueAdded")
                .withArgs(parseBtcInEbtc("5"), overissuedAmount);

            expect(await ebtc.balanceOf(registry.address)).to.equal(discountEbtcAmount);
            expect(await registry.confiscations(ebtc.address)).to.be.equal(discountEbtcAmount);
            expect(await registry.overissuedTotal()).to.equal(parseBtcInEbtc("5"));

            //offset overissue
            const ebtcAmount = parseBtcInEbtc("5");
            await expect(registry.connect(deployer).offsetOverissue(ebtcAmount))
                .to.emit(registry, "OffsetOverissued")
                .withArgs(deployer.address, ebtcAmount, 0);

            expect(await ebtc.balanceOf(registry.address)).to.equal(
                discountEbtcAmount.sub(ebtcAmount)
            );
            expect(await registry.confiscations(ebtc.address)).to.be.equal(
                discountEbtcAmount.sub(ebtcAmount)
            );
            expect(await registry.overissuedTotal()).to.equal(0);
        });
    });
});
