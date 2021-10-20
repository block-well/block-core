import { expect } from "chai";
import { Wallet } from "ethers";
import { deployments, waffle } from "hardhat";
import { Staking } from "../build/typechain";
import { advanceTimeAndBlock, currentTime } from "./helper";
import { DAY, WEEK } from "./time";

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture(["TestToken"]);

    const [deployer, ...users] = waffle.provider.getWallets();

    await deployments.deploy("Staking", {
        from: deployer.address,
    });
    const staking = (await ethers.getContract("Staking")) as Staking;

    return { staking, users };
});

describe("Staking", function () {
    let users: Wallet[];
    let staking: Staking;

    beforeEach(async function () {
        ({ staking, users } = await setupFixture());
    });

    describe("stake()", function () {
        it("cannot stake 0 amount", async function () {
            const user = users[0].address;
            await expect(staking.stake(user, 0)).to.revertedWith("stake 0 is not allowed");
        });

        it("should stake successfully and get correct data", async function () {
            let user = users[0].address;
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(0);
            expect(userData.data.length).to.be.equal(0);

            // 用户0质押 10 LP Token
            await staking.stake(user, 10);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(10);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            // 用户0一天后再质押 20 LP Token
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[1].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(await currentTime());

            // 用户1过了两天后质押 50 LP Token
            user = users[1].address;
            await advanceTimeAndBlock(DAY * 2);
            await staking.stake(user, 50);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(50);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[0].amount).to.be.equal(50);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            // 用户2过了一周后质押 100 LP Token
            user = users[2].address;
            await advanceTimeAndBlock(WEEK);
            await staking.stake(user, 100);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(100);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[0].amount).to.be.equal(100);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());
        });
    });

    describe("unstake()", function () {
        //用户质押了1笔(10LP)，在30天内全部取出
        it("unstake situation 1.1", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(10);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            await advanceTimeAndBlock(DAY * 15);
            await staking.unstake(user, 10);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(0);
            expect(userData.data.length).to.be.equal(0);
        });
        //用户质押了1笔(10LP)，在30-180天内全部取出
        it("unstake situation 1.2", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(10);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            await advanceTimeAndBlock(DAY * 100);
            await staking.unstake(user, 10);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(0);
            expect(userData.data.length).to.be.equal(0);
        });
        //用户质押了1笔(10LP)，在180天后全部取出
        it("unstake situation 1.3", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(10);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            await advanceTimeAndBlock(DAY * 200);
            await staking.unstake(user, 10);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(0);
            expect(userData.data.length).to.be.equal(0);
        });

        //用户质押了1笔(30LP)，在30天内取出一部分(10LP)
        it("unstake situation 2.1", async function () {
            const user = users[0].address;
            await staking.stake(user, 30);
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            const time = userData.data[0].stakeTime;
            expect(userData.data[0].amount).to.be.equal(30);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            await advanceTimeAndBlock(DAY * 15);
            await staking.unstake(user, 10);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(20);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(time);
            expect(userData.data[0].amount).to.be.equal(20);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());
        });
        //用户质押了1笔(30LP)，在30-180天内取出一部分(10LP)
        it("unstake situation 2.2", async function () {
            const user = users[0].address;
            await staking.stake(user, 30);
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            const time = userData.data[0].stakeTime;
            expect(userData.data[0].amount).to.be.equal(30);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            await advanceTimeAndBlock(DAY * 100);
            await staking.unstake(user, 10);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(20);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(time);
            expect(userData.data[0].amount).to.be.equal(20);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());
        });
        //用户质押了1笔(30LP)，在180天后取出一部分(10LP)
        it("unstake situation 2.1", async function () {
            const user = users[0].address;
            await staking.stake(user, 30);
            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(await currentTime());
            const time = userData.data[0].stakeTime;
            expect(userData.data[0].amount).to.be.equal(30);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());

            await advanceTimeAndBlock(DAY * 200);
            await staking.unstake(user, 10);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(20);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(time);
            expect(userData.data[0].amount).to.be.equal(20);
            expect(userData.data[0].timeForFee).to.be.equal(await currentTime());
        });

        //用户质押了2笔(10LP、20LP)，在30天内全部取出
        it("unstake situation 3.1", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 15);
            await staking.unstake(user, 30);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(0);
            expect(userData.data.length).to.be.equal(0);
        });
        //用户质押了2笔(10LP、20LP)，在30-180天内全部取出
        it("unstake situation 3.2", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 100);
            await staking.unstake(user, 30);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(0);
            expect(userData.data.length).to.be.equal(0);
        });
        //用户质押了2笔(10LP、20LP)，在180天后全部取出
        it("unstake situation 3.3", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 200);
            await staking.unstake(user, 30);
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(0);
            expect(userData.data.length).to.be.equal(0);
        });

        //用户质押了2笔(10LP、20LP)，在30天内取出一部分(5LP)
        it("unstake situation 4.1.1", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 15);
            await staking.unstake(user, 5);
            const time = await currentTime();
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(25);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(5);
            expect(userData.data[0].timeForFee).to.be.equal(time);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time);
        });
        //用户质押了2笔(10LP、20LP)，在30天内取出一部分(20LP)
        it("unstake situation 4.1.2", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 15);
            await staking.unstake(user, 20);
            const time = await currentTime();
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(10);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(time2);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time);
        });

        //用户质押了2笔(10LP、20LP)，在30-180天内取出一部分(5LP)
        it("unstake situation 4.2.1", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 100);
            await staking.unstake(user, 5);
            const time = await currentTime();
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(25);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(5);
            expect(userData.data[0].timeForFee).to.be.equal(time);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time);
        });
        //用户质押了2笔(10LP、20LP)，在30-180天内取出一部分(20LP)
        it("unstake situation 4.2.2", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 100);
            await staking.unstake(user, 20);
            const time = await currentTime();
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(10);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(time2);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time);
        });

        //用户质押了2笔(10LP、20LP)，在180天后取出一部分(5LP)
        it("unstake situation 4.3.1", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 200);
            await staking.unstake(user, 5);
            const time = await currentTime();
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(25);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(5);
            expect(userData.data[0].timeForFee).to.be.equal(time);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time);
        });
        //用户质押了2笔(10LP、20LP)，在180天后取出一部分(20LP)
        it("unstake situation 4.3.2", async function () {
            const user = users[0].address;
            await staking.stake(user, 10);
            const time1 = await currentTime();
            await advanceTimeAndBlock(DAY);
            await staking.stake(user, 20);
            const time2 = await currentTime();

            let userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(30);
            expect(userData.data.length).to.be.equal(2);
            expect(userData.data[0].stakeTime).to.be.equal(time1);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time1);
            expect(userData.data[1].stakeTime).to.be.equal(time2);
            expect(userData.data[1].amount).to.be.equal(20);
            expect(userData.data[1].timeForFee).to.be.equal(time2);

            await advanceTimeAndBlock(DAY * 200);
            await staking.unstake(user, 20);
            const time = await currentTime();
            userData = await staking.getUserData(user);
            expect(userData.totalAmount).to.be.equal(10);
            expect(userData.data.length).to.be.equal(1);
            expect(userData.data[0].stakeTime).to.be.equal(time2);
            expect(userData.data[0].amount).to.be.equal(10);
            expect(userData.data[0].timeForFee).to.be.equal(time);
        });
    });
});
