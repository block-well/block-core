import { expect } from "chai";
import { ethers } from "ethers";
import { deployments, waffle } from "hardhat";
import { BtcRater, ERC20 } from "../build/typechain";

const { parseUnits } = ethers.utils;
const num_1e8 = parseUnits("1.0", 8);
const num_1e18 = parseUnits("1.0", 18);

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

    describe("calcAmountInWei()", function () {
        it("should equal", async function () {
            expect(await rater.calcAmountInWei(wbtc.address, num_1e8)).equal(num_1e18);
            expect(await rater.calcAmountInWei(hbtc.address, num_1e18)).equal(num_1e18);
            expect(await rater.calcAmountInWei(cong.address, num_1e18)).equal(num_1e18);
        });
    });

    describe("calcOrigAmount()", function () {
        it("should equal", async function () {
            expect(await rater.calcOrigAmount(wbtc.address, num_1e18)).equal(num_1e8);
            expect(await rater.calcOrigAmount(hbtc.address, num_1e18)).equal(num_1e18);
            expect(await rater.calcOrigAmount(cong.address, num_1e18)).equal(num_1e18);
        });
    });
});
