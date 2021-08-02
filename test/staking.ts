import { expect } from "chai";
import { BigNumber, Wallet } from "ethers";
import { waffle, ethers, deployments } from "hardhat";
const { parseEther, parseUnits } = ethers.utils;
const parsePrecise = (value: string) => parseUnits(value, 18);
import {
    advanceBlock,
    advanceBlockAtTime,
    advanceTimeAndBlock,
    currentTime,
    setAutomine,
    WEEK,
} from "./helper";
import { ERC20, Staking } from "../build/typechain";

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer

    await deployments.deploy("DCS", {
        from: deployer.address,
        log: true,
    });
    const rewardToken = (await ethers.getContract("DCS")) as ERC20;

    await deployments.deploy("MockERC20", {
        from: deployer.address,
        log: true,
    });
    const stakedToken = (await ethers.getContract("MockERC20")) as ERC20;

    const startEpoch = await currentTime();
    const startTimestamp = startEpoch + WEEK;
    const endTimestamp = startTimestamp + WEEK * 10;

    await deployments.deploy("Staking", {
        from: deployer.address,
        args: [rewardToken.address, stakedToken.address, startTimestamp, endTimestamp],
        log: true,
    });
    const staking = (await ethers.getContract("Staking")) as Staking;

    const rate = parseEther("2");
    await rewardToken.connect(deployer).mint(deployer.address, rate.mul(10 * WEEK));
    await rewardToken.connect(deployer).approve(staking.address, rate.mul(10 * WEEK));

    const amount = parseEther("100");
    for (const user of users.slice(0, 4)) {
        await stakedToken.connect(deployer).mint(user.address, amount);
        await stakedToken.connect(user).approve(staking.address, amount);
    }

    return { users, deployer, rewardToken, stakedToken, staking, rate };
});

describe("Staking", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let rewardToken: ERC20;
    let stakedToken: ERC20;
    let staking: Staking;
    let startTimestamp: number;
    let endTimestamp: number;
    let rate: BigNumber;

    beforeEach(async function () {
        ({ deployer, users, rewardToken, stakedToken, staking, rate } = await setupFixture());
        startTimestamp = (await staking.startTimestamp()).toNumber();
        endTimestamp = (await staking.endTimestamp()).toNumber();
    });

    const calGlobalDivident = async (amount: BigNumber, startTime: number = startTimestamp) => {
        const endTime = Math.min(await currentTime(), endTimestamp);
        return parsePrecise((endTime - startTime).toString())
            .mul(rate)
            .div(amount);
    };

    const calUserRewards = async (
        userAmount: BigNumber,
        totalAmount: BigNumber,
        startTime: number = startTimestamp
    ) => {
        const endTime = Math.min(await currentTime(), endTimestamp);
        return BigNumber.from(endTime - startTime)
            .mul(rate)
            .mul(userAmount)
            .div(totalAmount);
    };

    describe("initialize()", function () {
        it("Should initialize", async function () {
            expect(await rewardToken.balanceOf(staking.address)).to.equal(0);
            expect(await staking.rate()).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(0);

            await expect(staking.connect(deployer).updateRate(rate))
                .to.emit(staking, "RateUpdated")
                .withArgs(0, rate);

            expect(await rewardToken.balanceOf(staking.address)).to.equal(rate.mul(10 * WEEK));
            expect(await staking.rate()).to.equal(rate);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(0);
        });
    });

    describe("deposit()", function () {
        beforeEach(async function () {
            await staking.connect(deployer).updateRate(rate);
        });

        it("Should deposit before start timestamp", async () => {
            expect(await stakedToken.balanceOf(staking.address)).to.equal(0);
            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(0);
            expect(await staking.stakes(users[0].address)).to.equal(0);

            const amount = parseEther("10");
            await expect(staking.connect(users[0]).depositAndClaim(amount))
                .to.emit(staking, "Deposit")
                .withArgs(users[0].address, amount, 0, 0);

            expect(await stakedToken.balanceOf(staking.address)).to.equal(amount);
            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(amount);
            expect(await staking.stakes(users[0].address)).to.equal(amount);
        });

        it("Should deposit before start timestamp and start accumulating rewards after start timestamp", async () => {
            const USER1_AMOUNT = parseEther("30");
            const USER2_AMOUNT = parseEther("10");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT);

            await staking.connect(users[0]).depositAndClaim(USER1_AMOUNT);
            await staking.connect(users[1]).depositAndClaim(USER2_AMOUNT);

            await advanceBlockAtTime(startTimestamp + 10);

            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);

            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(
                await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT)
            );

            const tx1 = await staking.connect(users[0]).claimRewards();
            expect(tx1)
                .to.emit(staking, "ClaimRewards")
                .withArgs(
                    users[0].address,
                    await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT),
                    await calGlobalDivident(TOTAL_AMOUNT)
                );

            expect(await staking.connect(users[1]).callStatic.claimRewards()).to.equal(
                await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT)
            );

            expect(await staking.globalDivident()).to.equal(await calGlobalDivident(TOTAL_AMOUNT));

            expect(await staking.connect(users[1]).callStatic.claimRewards()).to.equal(
                await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT)
            );

            const tx2 = await staking.connect(users[1]).claimRewards();
            expect(tx2)
                .to.emit(staking, "ClaimRewards")
                .withArgs(
                    users[1].address,
                    await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT),
                    await calGlobalDivident(TOTAL_AMOUNT)
                );

            expect(await staking.lastTimestamp()).to.equal(await currentTime());
            expect(await staking.globalDivident()).to.equal(await calGlobalDivident(TOTAL_AMOUNT));
        });

        it("Should deposit and accumulate rewards after start timestamp", async function () {
            const USER1_AMOUNT = parseEther("30");
            const USER2_AMOUNT = parseEther("10");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT);

            await advanceBlockAtTime(startTimestamp + WEEK);

            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(0);
            expect(await staking.calGlobalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(0);

            await setAutomine(false);
            await staking.connect(users[0]).depositAndClaim(USER1_AMOUNT);
            await staking.connect(users[1]).depositAndClaim(USER2_AMOUNT);
            await advanceBlock();
            await setAutomine(true);

            const startTime = await currentTime();
            expect(await staking.calGlobalDivident()).to.equal(0);
            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTime);

            await advanceTimeAndBlock(WEEK);

            expect(await staking.calGlobalDivident()).to.equal(
                await calGlobalDivident(TOTAL_AMOUNT, startTime)
            );

            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(
                await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT, startTime)
            );
            expect(await staking.connect(users[1]).callStatic.claimRewards()).to.equal(
                await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT, startTime)
            );
            expect(await staking.lastTimestamp()).to.equal(startTime);
        });

        it("Should deposit but receive no more rewards after end timestamp", async function () {
            const USER1_AMOUNT = parseEther("30");
            const USER2_AMOUNT = parseEther("10");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT);

            await staking.connect(users[0]).depositAndClaim(USER1_AMOUNT);
            await staking.connect(users[1]).depositAndClaim(USER2_AMOUNT);

            await advanceBlockAtTime(startTimestamp + 11 * WEEK);

            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(
                await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT)
            );
            const tx = await staking.connect(users[1]).claimRewards();
            expect(tx)
                .to.emit(staking, "ClaimRewards")
                .withArgs(
                    users[1].address,
                    await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT),
                    await calGlobalDivident(TOTAL_AMOUNT)
                );
            expect(await staking.lastTimestamp()).to.equal(endTimestamp);
        });
    });

    describe("withdraw()", function () {
        beforeEach(async function () {
            await staking.updateRate(rate);
            await staking.connect(users[0]).depositAndClaim(parseEther("30"));
            await staking.connect(users[1]).depositAndClaim(parseEther("10"));
        });

        it("Should withdraw before start timestamp", async function () {
            await staking.connect(users[0]).withdrawAndClaim(parseEther("10"));

            expect(await stakedToken.balanceOf(staking.address)).to.equal(parseEther("30"));
            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(parseEther("30"));
            expect(await staking.stakes(users[0].address)).to.equal(parseEther("20"));
        });

        it("Should withdraw deposits deposited before start timestamp", async function () {
            const USER1_AMOUNT = parseEther("30");
            const USER2_AMOUNT = parseEther("10");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT);

            await advanceBlockAtTime(startTimestamp + 10);

            const amount = parseEther("10");
            const tx = await staking.connect(users[0]).withdrawAndClaim(amount);
            expect(tx)
                .to.emit(staking, "Withdraw")
                .withArgs(
                    users[0].address,
                    amount,
                    await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT),
                    await calGlobalDivident(TOTAL_AMOUNT)
                );

            expect(await stakedToken.balanceOf(staking.address)).to.equal(parseEther("30"));
            expect(await staking.connect(users[0]).callStatic.claimRewards()).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(await currentTime());
            expect(await staking.globalDivident()).to.equal(await calGlobalDivident(TOTAL_AMOUNT));
            expect(await staking.totalStakes()).to.equal(parseEther("30"));
            expect(await staking.stakes(users[0].address)).to.equal(parseEther("20"));
        });
    });

    describe("claimRewards()", function () {
        beforeEach(async function () {
            await staking.updateRate(rate);
        });

        it("Should claim rewards", async function () {
            const USER1_AMOUNT = parseEther("10");
            const USER2_AMOUNT = parseEther("20");
            const USER3_AMOUNT = parseEther("30");
            const USER4_AMOUNT = parseEther("40");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT).add(USER3_AMOUNT).add(USER4_AMOUNT);

            await setAutomine(false);
            await staking.connect(users[0]).depositAndClaim(USER1_AMOUNT);
            await staking.connect(users[1]).depositAndClaim(USER2_AMOUNT);
            await staking.connect(users[2]).depositAndClaim(USER3_AMOUNT);
            await staking.connect(users[3]).depositAndClaim(USER4_AMOUNT);
            await advanceBlockAtTime(startTimestamp);
            await setAutomine(true);

            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);
            expect(await rewardToken.balanceOf(users[1].address)).to.equal(0);
            expect(await rewardToken.balanceOf(users[2].address)).to.equal(0);
            expect(await rewardToken.balanceOf(users[3].address)).to.equal(0);

            await setAutomine(false);
            await staking.connect(users[0]).depositAndClaim(parseEther("10"));
            await staking.connect(users[1]).withdrawAndClaim(parseEther("10"));
            await staking.connect(users[2]).depositAndClaim(parseEther("10"));
            await staking.connect(users[3]).withdrawAndClaim(parseEther("10"));
            await advanceBlockAtTime(startTimestamp + 1 * WEEK);
            await setAutomine(true);

            expect(await staking.lastTimestamp()).to.equal(await currentTime());
            let user1Reward = await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT);
            let user2Reward = await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT);
            let user3Reward = await calUserRewards(USER3_AMOUNT, TOTAL_AMOUNT);
            let user4Reward = await calUserRewards(USER4_AMOUNT, TOTAL_AMOUNT);

            expect(await rewardToken.balanceOf(users[0].address)).to.equal(user1Reward);
            expect(await rewardToken.balanceOf(users[1].address)).to.equal(user2Reward);
            expect(await rewardToken.balanceOf(users[2].address)).to.equal(user3Reward);
            expect(await rewardToken.balanceOf(users[3].address)).to.equal(user4Reward);

            let lastTime = await currentTime();
            await setAutomine(false);
            await staking.connect(users[0]).withdrawAndClaim(parseEther("20"));
            await staking.connect(users[1]).depositAndClaim(parseEther("20"));
            await staking.connect(users[2]).withdrawAndClaim(parseEther("20"));
            await staking.connect(users[3]).depositAndClaim(parseEther("20"));
            await advanceBlockAtTime(startTimestamp + 2 * WEEK);
            await setAutomine(true);

            expect(await staking.lastTimestamp()).to.equal(await currentTime());
            user1Reward = user1Reward.add(
                await calUserRewards(USER1_AMOUNT.add(parseEther("10")), TOTAL_AMOUNT, lastTime)
            );
            user2Reward = user2Reward.add(
                await calUserRewards(USER2_AMOUNT.sub(parseEther("10")), TOTAL_AMOUNT, lastTime)
            );
            user3Reward = user3Reward.add(
                await calUserRewards(USER3_AMOUNT.add(parseEther("10")), TOTAL_AMOUNT, lastTime)
            );
            user4Reward = user4Reward.add(
                await calUserRewards(USER4_AMOUNT.sub(parseEther("10")), TOTAL_AMOUNT, lastTime)
            );

            expect(await rewardToken.balanceOf(users[0].address)).to.equal(user1Reward);
            expect(await rewardToken.balanceOf(users[1].address)).to.equal(user2Reward);
            expect(await rewardToken.balanceOf(users[2].address)).to.equal(user3Reward);
            expect(await rewardToken.balanceOf(users[3].address)).to.equal(user4Reward);

            lastTime = await currentTime();
            await setAutomine(false);
            await staking.connect(users[0]).claimRewards();
            await staking.connect(users[1]).claimRewards();
            await staking.connect(users[2]).claimRewards();
            await staking.connect(users[3]).claimRewards();
            await advanceBlockAtTime(startTimestamp + 3 * WEEK);
            await setAutomine(true);

            user1Reward = user1Reward.add(0);
            user2Reward = user2Reward.add(
                await calUserRewards(USER2_AMOUNT.add(parseEther("10")), TOTAL_AMOUNT, lastTime)
            );
            user3Reward = user3Reward.add(
                await calUserRewards(USER3_AMOUNT.sub(parseEther("10")), TOTAL_AMOUNT, lastTime)
            );
            user4Reward = user4Reward.add(
                await calUserRewards(USER4_AMOUNT.add(parseEther("10")), TOTAL_AMOUNT, lastTime)
            );

            expect(await rewardToken.balanceOf(users[0].address)).to.equal(user1Reward);
            expect(await rewardToken.balanceOf(users[1].address)).to.equal(user2Reward);
            expect(await rewardToken.balanceOf(users[2].address)).to.equal(user3Reward);
            expect(await rewardToken.balanceOf(users[3].address)).to.equal(user4Reward);
        });
    });
});
