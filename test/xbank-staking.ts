import { expect } from "chai";
import { deployments, waffle } from "hardhat";
import { Staking } from "../build/typechain";
import { currentTime } from "./helper";

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture(["TestToken"]);

    const [deployer] = waffle.provider.getWallets();

    await deployments.deploy("Staking", {
        from: deployer.address,
    });
    const staking = (await ethers.getContract("Staking")) as Staking;

    return { staking };
});

describe("Staking", function () {
    let staking: Staking;

    beforeEach(async function () {
        ({ staking } = await setupFixture());
    });

    describe("stake()", function () {
        it("should stake successfully", async function () {
            const user = "0xbf78314073a69E2178798F501A8114179c3E41ba";
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(0);
            expect(userData.data.length).to.be.equal(0);

            await staking.stake(user, 10);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(10);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            await staking.stake(user, 20);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[1].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(await currentTime());
        });
    });

    describe("unstake()", function () {
        it("unstake situation 1", async function () {
            const user = "0xbf78314073a69E2178798F501A8114179c3E41ba";
            await staking.stake(user, 10);
            await staking.stake(user, 20);

            await staking.unstake(user, 5);
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(25);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].amount).to.be.equal(5);
            expect(userData.data[1].amount).to.be.equal(20);
        });
        it("unstake situation 2", async function () {
            const user = "0xbf78314073a69E2178798F501A8114179c3E41ba";
            await staking.stake(user, 10);
            await staking.stake(user, 20);

            let userData = await staking.getUserData(user);
            console.log(userData.toString());

            await staking.unstake(user, 15);
            userData = await staking.getUserData(user);
            console.log(userData.toString());
            console.log(userData.data.length);

            // expect(userData.totalAmount).to.be.equal(15);
            // expect(userData.data.length).to.be.equal(1);
            // expect(userData.data[0].amount).to.be.equal(15);
            // expect(userData.data[0].timeForFee).to.be.equal(await currentTime());
        });
    });

    // describe("checkReward()", function () {
    //     it("should get correct reward", async function () {
    //         await staking.stake("0xbf78314073a69E2178798F501A8114179c3E41ba", 10);
    //         await staking.stake("0xbf78314073a69E2178798F501A8114179c3E41ba", 20);

    //         const reward = await staking.checkReward("0xbf78314073a69E2178798F501A8114179c3E41ba");
    //         console.log(reward.toString());
    //     });
    // });
});
