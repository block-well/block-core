import { expect } from "chai";
import { ethers } from "ethers";
import { deployments, waffle } from "hardhat";
import { BtcRater, ERC20 } from "../build/typechain";

const { parseUnits } = ethers.utils;
const wbtcAmt = (value: string) => parseUnits(value, 8);
const hbtcAmt = (value: string) => parseUnits(value, 18);
const satsAmt = (value: string) => parseUnits(value, 18);

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer] = waffle.provider.getWallets();

    await deployments.deploy("MockWBTC", { from: deployer.address });
    const wbtc = (await ethers.getContract("MockWBTC")) as ERC20;

    await deployments.deploy("MockHBTC", { contract: "MockERC20", from: deployer.address });
    const hbtc = (await ethers.getContract("MockHBTC")) as ERC20;

    await deployments.deploy("SATS", { from: deployer.address });
    const sats = (await ethers.getContract("SATS")) as ERC20;

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [wbtc.address, hbtc.address, sats.address],
            [1, 1, 1e8],
        ],
    });
    const rater = (await ethers.getContract("BtcRater")) as BtcRater;

    return { wbtc, hbtc, sats, rater };
});

describe("BtcRater", function () {
    let wbtc: ERC20;
    let hbtc: ERC20;
    let sats: ERC20;
    let rater: BtcRater;

    beforeEach(async function () {
        ({ wbtc, hbtc, sats, rater } = await setupFixture());
    });

    describe("calcAmountInWei()", function () {
        it("should equal", async function () {
            expect(await rater.calcAmountInWei(wbtc.address, wbtcAmt("1"))).equal(
                parseUnits("1", 18)
            );
            expect(await rater.calcAmountInWei(wbtc.address, wbtcAmt("0.00000001"))).equal(
                parseUnits("0.00000001", 18)
            );
            expect(await rater.calcAmountInWei(wbtc.address, wbtcAmt("500"))).equal(
                parseUnits("500", 18)
            );
            expect(await rater.calcAmountInWei(hbtc.address, hbtcAmt("1"))).equal(
                parseUnits("1", 18)
            );
            expect(await rater.calcAmountInWei(sats.address, satsAmt("1"))).equal(
                parseUnits("1", 18)
            );
        });
    });

    describe("calcOrigAmount()", function () {
        it("should equal", async function () {
            expect(await rater.calcOrigAmount(wbtc.address, parseUnits("1", 18))).equal(
                wbtcAmt("1")
            );
            expect(await rater.calcOrigAmount(wbtc.address, parseUnits("0.00000001", 18))).equal(
                wbtcAmt("0.00000001")
            );
            expect(await rater.calcOrigAmount(wbtc.address, parseUnits("500", 18))).equal(
                wbtcAmt("500")
            );
            expect(await rater.calcOrigAmount(hbtc.address, parseUnits("1", 18))).equal(
                hbtcAmt("1")
            );
            expect(await rater.calcOrigAmount(sats.address, parseUnits("1", 18))).equal(
                satsAmt("1")
            );
        });
    });
});
