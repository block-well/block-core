import { expect } from "chai";
import { ethers } from "ethers";
import { deployments, waffle } from "hardhat";
import { BtcRater, ERC20 } from "../build/typechain";

const { parseUnits } = ethers.utils;

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer, ...users] = waffle.provider.getWallets();

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

    await deployments.deploy("CONG", {
        from: deployer.address,
        log: true,
    });
    const cong = (await ethers.getContract("CONG")) as ERC20;

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [wbtc.address, hbtc.address, cong.address],
            [1, 1, 1e8],
        ],
        log: true,
    });
    const rater = (await ethers.getContract("BtcRater")) as BtcRater;

    return { wbtc, hbtc, cong, rater };
});

describe("BtcRater", function () {
    let wbtc: ERC20;
    let hbtc: ERC20;
    let cong: ERC20;
    let rater: BtcRater;

    beforeEach(async function () {
        ({ wbtc, hbtc, cong, rater } = await setupFixture());
    });

    describe("calcAmountInSatoshi()", function () {
        it("should equal when calc in Satoshi", async function () {
            expect(await rater.calcAmountInSatoshi(wbtc.address, 1e8)).equal(1e8);
            expect(await rater.calcAmountInSatoshi(hbtc.address, parseUnits("1.0"))).equal(1e8);
            expect(await rater.calcAmountInSatoshi(cong.address, parseUnits("1.0"))).equal(1e8);
        });
    });

    describe("calcAmountInWei()", function () {
        it("should equal when calc in Wei", async function () {
            expect(await rater.calcAmountInWei(wbtc.address, 1e8)).equal(parseUnits("1.0"));
            expect(await rater.calcAmountInWei(hbtc.address, parseUnits("1.0"))).equal(
                parseUnits("1.0")
            );
            expect(await rater.calcAmountInWei(cong.address, parseUnits("1.0"))).equal(
                parseUnits("1.0")
            );
        });
    });
});
