import { expect } from "chai";
import { BigNumber, ethers, Wallet } from "ethers";
import { deployments, waffle } from "hardhat";
import { BtcRater, ERC20, Treasury } from "../build/typechain";

const { parseUnits } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
const parseBtcInSats = (value: string) => parseUnits(value, 18);

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer] = waffle.provider.getWallets();

    await deployments.deploy("MockWBTC", {
        from: deployer.address,
        log: true,
    });
    const wbtc = (await ethers.getContract("MockWBTC")) as ERC20;

    await deployments.deploy("MockHBTC", {
        contract: "MockERC20",
        from: deployer.address,
        log: true,
    });
    const hbtc = (await ethers.getContract("MockHBTC")) as ERC20;

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

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [wbtc.address, hbtc.address, sats.address],
            [1, 1, 1e8],
        ],
        log: true,
    });
    const btcRater = (await ethers.getContract("BtcRater")) as BtcRater;

    await deployments.deploy("Treasury", {
        from: deployer.address,
        args: [sats.address, btcRater.address],
        log: true,
    });
    const treasury = (await ethers.getContract("Treasury")) as Treasury;

    return { deployer, wbtc, sats, treasury };
});

describe("Treasury", function () {
    let deployer: Wallet;
    let wbtc: ERC20;
    let sats: ERC20;
    let treasury: Treasury;

    beforeEach(async function () {
        ({ deployer, wbtc, sats, treasury } = await setupFixture());
    });

    describe("assetAuction()", async function () {
        let asset: string;
        let amount: BigNumber;

        beforeEach(async function () {
            await treasury.initLiquidation(1626336970);
            await treasury.setRegulation(1, 1);
            asset = wbtc.address;
            amount = parseBtc("10");
        });

        it("can not auction before start time", async function () {
            await treasury.initLiquidation(9999999999);
            await expect(treasury.assetAuction(asset, amount)).to.revertedWith("auction not start");
        });

        it("can not auction if contract's asset balance is not enough", async function () {
            await expect(treasury.assetAuction(asset, amount)).to.revertedWith(
                "not enough asset balance"
            );
        });

        it("can not auction if user's SATS balance is not enough", async function () {
            await wbtc.mint(treasury.address, parseBtc("100"));
            await expect(treasury.assetAuction(asset, amount)).to.revertedWith(
                "not enough SATS balance"
            );
        });

        it("should auction success", async function () {
            //这里拿deployer同时作为合约的部署者和调用者
            await wbtc.mint(treasury.address, parseBtc("100"));
            await sats.connect(deployer).mint(deployer.address, parseBtcInSats("100"));
            await sats.connect(deployer).approve(treasury.address, parseBtcInSats("100"));

            //contract原始余额
            const origContractWbtc = await wbtc.balanceOf(treasury.address);
            const origContractSats = await sats.balanceOf(treasury.address);

            //user原始余额
            const origUserWbtc = await wbtc.balanceOf(deployer.address);
            const origUserSats = await sats.balanceOf(deployer.address);

            const price = await treasury.getPriceAfterDiscount(asset, amount);

            await treasury.assetAuction(asset, amount);

            expect(await wbtc.balanceOf(treasury.address)).to.equal(origContractWbtc.sub(amount));
            expect(await sats.balanceOf(treasury.address)).to.equal(origContractSats.add(price));
            expect(await wbtc.balanceOf(deployer.address)).to.equal(origUserWbtc.add(amount));
            expect(await sats.balanceOf(deployer.address)).to.equal(origUserSats.sub(price));
        });
    });
});
