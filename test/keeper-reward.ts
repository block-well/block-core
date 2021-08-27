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
    DAY,
} from "./helper";
import { DCS, ERC20, KeeperReward } from "../build/typechain";

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    await deployments.fixture([]);

    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer

    await deployments.deploy("DCS", { from: deployer.address });
    const rewardToken = (await ethers.getContract("DCS")) as DCS;

    await deployments.deploy("MockERC20", {
        from: deployer.address,
        args: ["StakeToken", "StakeToken", 18],
    });
    const stakedToken = (await ethers.getContract("MockERC20")) as ERC20;

    const currentTimestamp = await currentTime();
    const startTimestamp = currentTimestamp + WEEK;
    const duration = 10 * WEEK;
    const endTimestamp = startTimestamp + duration;

    const validator = ethers.Wallet.createRandom();

    await deployments.deploy("KeeperReward", {
        from: deployer.address,
        args: [
            rewardToken.address,
            stakedToken.address,
            startTimestamp,
            endTimestamp,
            validator.address,
        ],
    });
    const stakingReward = (await ethers.getContract("KeeperReward")) as KeeperReward;

    const rate = parseEther("2");
    await rewardToken.connect(deployer).mint(deployer.address, rate.mul(duration));
    await rewardToken.connect(deployer).approve(stakingReward.address, rate.mul(duration));

    const amount = parseEther("100");
    for (const user of users.slice(0, 4)) {
        await stakedToken.connect(deployer).mint(user.address, amount);
        await stakedToken.connect(user).approve(stakingReward.address, amount);
    }

    return { users, deployer, rewardToken, stakedToken, stakingReward, rate, validator };
});

describe("KeeperReward", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let validator: Wallet;
    let rewardToken: DCS;
    let stakedToken: ERC20;
    let staking: KeeperReward;
    let startTimestamp: number;
    let endTimestamp: number;
    let rate: BigNumber;

    beforeEach(async function () {
        ({
            deployer,
            users,
            rewardToken,
            stakedToken,
            stakingReward: staking,
            rate,
            validator,
        } = await setupFixture());
        startTimestamp = (await staking.startTimestamp()).toNumber();
        endTimestamp = (await staking.endTimestamp()).toNumber();
    });

    const types = {
        OnlineProof: [
            { name: "timestamp", type: "uint256" },
            { name: "keeper", type: "address" },
        ],
    };

    const getOnlineProof = async (keeper: string, timestamp = 0) => {
        if (timestamp === 0) timestamp = await currentTime();

        const domain = {
            name: "KeeperReward",
            version: "1.0",
            chainId: 31337,
            verifyingContract: staking.address,
        };
        const value = {
            keeper,
            timestamp,
        };

        const signature = await validator._signTypedData(domain, types, value);
        const sig = ethers.utils.splitSignature(signature);

        return {
            keeper: keeper,
            timestamp: timestamp,
            r: sig.r,
            s: sig.s,
            v: sig.v,
        };
    };

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
                .to.emit(staking, "UpdateRate")
                .withArgs(rate);

            expect(await rewardToken.balanceOf(staking.address)).to.equal(rate.mul(10 * WEEK));
            expect(await staking.rate()).to.equal(rate);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(0);
        });
    });

    describe("stake()", function () {
        beforeEach(async function () {
            await staking.connect(deployer).updateRate(rate);
        });

        it("Should stake before start timestamp", async () => {
            expect(await stakedToken.balanceOf(staking.address)).to.equal(0);
            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(0);
            expect(await staking.stakes(users[0].address)).to.equal(0);

            const amount = parseEther("10");
            await expect(
                staking.connect(users[0]).stake(amount, await getOnlineProof(users[0].address))
            )
                .to.emit(staking, "Stake")
                .withArgs(users[0].address, amount, 0, 0);

            expect(await stakedToken.balanceOf(staking.address)).to.equal(amount);
            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(amount);
            expect(await staking.stakes(users[0].address)).to.equal(amount);
        });

        it("Should stake before start timestamp and start accumulating rewards after start timestamp", async () => {
            const USER1_AMOUNT = parseEther("30");
            const USER2_AMOUNT = parseEther("10");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT);

            await staking
                .connect(users[0])
                .stake(USER1_AMOUNT, await getOnlineProof(users[0].address));
            await staking
                .connect(users[1])
                .stake(USER2_AMOUNT, await getOnlineProof(users[1].address));

            await advanceBlockAtTime(startTimestamp + 10);

            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);

            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT));

            const tx1 = await staking
                .connect(users[0])
                .claim(await getOnlineProof(users[0].address));
            expect(tx1)
                .to.emit(staking, "Claim")
                .withArgs(
                    users[0].address,
                    await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT),
                    await calGlobalDivident(TOTAL_AMOUNT)
                );

            expect(
                await staking
                    .connect(users[1])
                    .callStatic.claim(await getOnlineProof(users[1].address))
            ).to.equal(await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT));

            expect(await staking.globalDivident()).to.equal(await calGlobalDivident(TOTAL_AMOUNT));

            expect(
                await staking
                    .connect(users[1])
                    .callStatic.claim(await getOnlineProof(users[1].address))
            ).to.equal(await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT));

            const tx2 = await staking
                .connect(users[1])
                .claim(await getOnlineProof(users[1].address));
            expect(tx2)
                .to.emit(staking, "Claim")
                .withArgs(
                    users[1].address,
                    await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT),
                    await calGlobalDivident(TOTAL_AMOUNT)
                );

            expect(await staking.lastTimestamp()).to.equal(await currentTime());
            expect(await staking.globalDivident()).to.equal(await calGlobalDivident(TOTAL_AMOUNT));
        });

        it("Should stake and accumulate rewards after start timestamp", async function () {
            const USER1_AMOUNT = parseEther("30");
            const USER2_AMOUNT = parseEther("10");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT);

            await advanceBlockAtTime(startTimestamp + WEEK);

            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(0);
            expect(await staking.calGlobalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(0);

            await setAutomine(false);
            await staking
                .connect(users[0])
                .stake(USER1_AMOUNT, await getOnlineProof(users[0].address));
            await staking
                .connect(users[1])
                .stake(USER2_AMOUNT, await getOnlineProof(users[1].address));
            await advanceBlock();
            await setAutomine(true);

            const startTime = await currentTime();
            expect(await staking.calGlobalDivident()).to.equal(0);
            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTime);

            await advanceTimeAndBlock(WEEK);

            expect(await staking.calGlobalDivident()).to.equal(
                await calGlobalDivident(TOTAL_AMOUNT, startTime)
            );

            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT, startTime));
            expect(
                await staking
                    .connect(users[1])
                    .callStatic.claim(await getOnlineProof(users[1].address))
            ).to.equal(await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT, startTime));
            expect(await staking.lastTimestamp()).to.equal(startTime);
        });

        it("Should stake but receive no more rewards after end timestamp", async function () {
            const USER1_AMOUNT = parseEther("30");
            const USER2_AMOUNT = parseEther("10");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT);

            await staking
                .connect(users[0])
                .stake(USER1_AMOUNT, await getOnlineProof(users[0].address));
            await staking
                .connect(users[1])
                .stake(USER2_AMOUNT, await getOnlineProof(users[1].address));

            await advanceBlockAtTime(startTimestamp + 11 * WEEK);

            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT));
            const tx = await staking
                .connect(users[1])
                .claim(await getOnlineProof(users[1].address));
            expect(tx)
                .to.emit(staking, "Claim")
                .withArgs(
                    users[1].address,
                    await calUserRewards(USER2_AMOUNT, TOTAL_AMOUNT),
                    await calGlobalDivident(TOTAL_AMOUNT)
                );
            expect(await staking.lastTimestamp()).to.equal(endTimestamp);
        });

        it("Stake with proof out of time", async () => {
            const currentTimestamp = await currentTime();
            const amount = parseEther("1");
            await expect(
                staking
                    .connect(users[0])
                    .stake(amount, await getOnlineProof(users[0].address, currentTimestamp - DAY))
            ).to.revertedWith("out of time");
        });

        it("Stake using proof with wrong timestamp", async () => {
            const currentTimestamp = await currentTime();
            const amount = parseEther("1");
            const proof = await getOnlineProof(users[0].address, currentTimestamp - DAY);
            proof.timestamp = currentTimestamp;
            await expect(staking.connect(users[0]).stake(amount, proof)).to.revertedWith(
                "invalid signature"
            );
        });

        it("Stake using proof with wrong user", async () => {
            const currentTimestamp = await currentTime();
            const amount = parseEther("1");
            const proof = await getOnlineProof(users[1].address, currentTimestamp);
            proof.keeper = users[0].address;
            await expect(staking.connect(users[0]).stake(amount, proof)).to.revertedWith(
                "invalid signature"
            );
        });

        it("Stake with proof from different user", async () => {
            const currentTimestamp = await currentTime();
            const amount = parseEther("1");

            expect(await staking.stakes(users[0].address)).to.equal(0);
            expect(await staking.stakes(users[1].address)).to.equal(0);
            await expect(
                staking
                    .connect(users[1])
                    .stake(amount, await getOnlineProof(users[0].address, currentTimestamp))
            )
                .to.emit(staking, "Stake")
                .withArgs(users[0].address, amount, 0, 0);

            expect(await staking.stakes(users[0].address)).to.equal(amount);
            expect(await staking.stakes(users[1].address)).to.equal(0);
        });
    });

    describe("unstake()", function () {
        beforeEach(async function () {
            await staking.updateRate(rate);
            await staking
                .connect(users[0])
                .stake(parseEther("30"), await getOnlineProof(users[0].address));
            await staking
                .connect(users[1])
                .stake(parseEther("10"), await getOnlineProof(users[1].address));
        });

        it("Should unstake before start timestamp", async function () {
            await staking
                .connect(users[0])
                .unstake(parseEther("10"), await getOnlineProof(users[0].address));

            expect(await stakedToken.balanceOf(staking.address)).to.equal(parseEther("30"));
            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await staking.globalDivident()).to.equal(0);
            expect(await staking.totalStakes()).to.equal(parseEther("30"));
            expect(await staking.stakes(users[0].address)).to.equal(parseEther("20"));
        });

        it("Should unstake before start timestamp", async function () {
            const USER1_AMOUNT = parseEther("30");
            const USER2_AMOUNT = parseEther("10");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT);

            await advanceBlockAtTime(startTimestamp + 10);

            const amount = parseEther("10");
            const tx = await staking
                .connect(users[0])
                .unstake(amount, await getOnlineProof(users[0].address));
            expect(tx)
                .to.emit(staking, "Unstake")
                .withArgs(
                    users[0].address,
                    amount,
                    await calUserRewards(USER1_AMOUNT, TOTAL_AMOUNT),
                    await calGlobalDivident(TOTAL_AMOUNT)
                );

            expect(await stakedToken.balanceOf(staking.address)).to.equal(parseEther("30"));
            expect(
                await staking
                    .connect(users[0])
                    .callStatic.claim(await getOnlineProof(users[0].address))
            ).to.equal(0);
            expect(await staking.lastTimestamp()).to.equal(await currentTime());
            expect(await staking.globalDivident()).to.equal(await calGlobalDivident(TOTAL_AMOUNT));
            expect(await staking.totalStakes()).to.equal(parseEther("30"));
            expect(await staking.stakes(users[0].address)).to.equal(parseEther("20"));
        });

        it("Unstake with proof out of time", async () => {
            const currentTimestamp = await currentTime();
            const amount = parseEther("1");
            await expect(
                staking
                    .connect(users[0])
                    .unstake(amount, await getOnlineProof(users[0].address, currentTimestamp - DAY))
            ).to.revertedWith("out of time");
        });

        it("Unstake with proof from different user", async () => {
            const currentTimestamp = await currentTime();
            const amount = parseEther("1");

            expect(await staking.stakes(users[0].address)).to.equal(parseEther("30"));
            expect(await staking.stakes(users[1].address)).to.equal(parseEther("10"));
            await expect(
                staking
                    .connect(users[1])
                    .unstake(amount, await getOnlineProof(users[0].address, currentTimestamp))
            )
                .to.emit(staking, "Unstake")
                .withArgs(users[0].address, amount, 0, 0);

            expect(await staking.stakes(users[0].address)).to.equal(parseEther("29"));
            expect(await staking.stakes(users[1].address)).to.equal(parseEther("10"));
        });
    });

    describe("claim()", function () {
        beforeEach(async function () {
            await staking.updateRate(rate);
        });

        it("Should claim rewards", async function () {
            const USER1_AMOUNT = parseEther("10");
            const USER2_AMOUNT = parseEther("20");
            const USER3_AMOUNT = parseEther("30");
            const USER4_AMOUNT = parseEther("40");
            const TOTAL_AMOUNT = USER1_AMOUNT.add(USER2_AMOUNT).add(USER3_AMOUNT).add(USER4_AMOUNT);

            let nextTimestamp = startTimestamp;
            await setAutomine(false);
            await staking
                .connect(users[0])
                .stake(USER1_AMOUNT, await getOnlineProof(users[0].address, nextTimestamp));
            await staking
                .connect(users[1])
                .stake(USER2_AMOUNT, await getOnlineProof(users[1].address, nextTimestamp));
            await staking
                .connect(users[2])
                .stake(USER3_AMOUNT, await getOnlineProof(users[2].address, nextTimestamp));
            await staking
                .connect(users[3])
                .stake(USER4_AMOUNT, await getOnlineProof(users[3].address, nextTimestamp));
            await advanceBlockAtTime(startTimestamp);
            await setAutomine(true);

            expect(await staking.lastTimestamp()).to.equal(startTimestamp);
            expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);
            expect(await rewardToken.balanceOf(users[1].address)).to.equal(0);
            expect(await rewardToken.balanceOf(users[2].address)).to.equal(0);
            expect(await rewardToken.balanceOf(users[3].address)).to.equal(0);

            nextTimestamp = startTimestamp + 1 * WEEK;
            await setAutomine(false);
            await staking
                .connect(users[0])
                .stake(parseEther("10"), await getOnlineProof(users[0].address, nextTimestamp));
            await staking
                .connect(users[1])
                .unstake(parseEther("10"), await getOnlineProof(users[1].address, nextTimestamp));
            await staking
                .connect(users[2])
                .stake(parseEther("10"), await getOnlineProof(users[2].address, nextTimestamp));
            await staking
                .connect(users[3])
                .unstake(parseEther("10"), await getOnlineProof(users[3].address, nextTimestamp));
            await advanceBlockAtTime(nextTimestamp);
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

            nextTimestamp = startTimestamp + 2 * WEEK;
            let lastTime = await currentTime();
            await setAutomine(false);
            await staking
                .connect(users[0])
                .unstake(parseEther("20"), await getOnlineProof(users[0].address, nextTimestamp));
            await staking
                .connect(users[1])
                .stake(parseEther("20"), await getOnlineProof(users[1].address, nextTimestamp));
            await staking
                .connect(users[2])
                .unstake(parseEther("20"), await getOnlineProof(users[2].address, nextTimestamp));
            await staking
                .connect(users[3])
                .stake(parseEther("20"), await getOnlineProof(users[3].address, nextTimestamp));
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

            nextTimestamp = startTimestamp + 3 * WEEK;
            lastTime = await currentTime();
            await setAutomine(false);
            await staking
                .connect(users[0])
                .claim(await getOnlineProof(users[0].address, nextTimestamp));
            await staking
                .connect(users[1])
                .claim(await getOnlineProof(users[1].address, nextTimestamp));
            await staking
                .connect(users[2])
                .claim(await getOnlineProof(users[2].address, nextTimestamp));
            await staking
                .connect(users[3])
                .claim(await getOnlineProof(users[3].address, nextTimestamp));
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

        it("Claim with proof out of time", async () => {
            const currentTimestamp = await currentTime();
            await expect(
                staking
                    .connect(users[0])
                    .claim(await getOnlineProof(users[0].address, currentTimestamp - DAY))
            ).to.revertedWith("out of time");
        });

        it("Claim with proof from different user", async () => {
            await staking
                .connect(users[0])
                .stake(parseEther("30"), await getOnlineProof(users[0].address));

            await advanceBlockAtTime(startTimestamp + DAY);

            expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);
            expect(await rewardToken.balanceOf(users[1].address)).to.equal(0);

            await staking.connect(users[1]).claim(await getOnlineProof(users[0].address));

            expect(await rewardToken.balanceOf(users[0].address)).to.gt(0);
            expect(await rewardToken.balanceOf(users[1].address)).to.equal(0);
        });
    });

    describe("set()", function () {
        it("setValidator", async function () {
            const newValidator = ethers.Wallet.createRandom();
            await expect(
                staking.connect(users[0]).setValidator(newValidator.address)
            ).to.revertedWith("Ownable: caller is not the owner");

            await expect(staking.connect(deployer).setValidator(newValidator.address))
                .to.emit(staking, "SetValidator")
                .withArgs(newValidator.address);
        });

        it("setTimespan", async function () {
            await expect(staking.connect(users[0]).setTimespan(10, 10, 10)).to.revertedWith(
                "Ownable: caller is not the owner"
            );

            await expect(staking.connect(deployer).setTimespan(10, 10, 10))
                .to.emit(staking, "SetTimespan")
                .withArgs(10, 10, 10);
        });

        it("setPenalty", async function () {
            await expect(staking.connect(users[0]).setPenalty(10)).to.revertedWith(
                "Ownable: caller is not the owner"
            );

            await expect(staking.connect(deployer).setPenalty(10))
                .to.emit(staking, "SetPenalty")
                .withArgs(10);
        });
    });

    describe("accuse()", function () {
        const stakeAmount = parseEther("10");
        let totalAmount: BigNumber;
        let target: Wallet;
        let accuser: Wallet;
        let accuser2: Wallet;
        let accusationPenalty: BigNumber;
        let appealTimespan: BigNumber;

        beforeEach(async function () {
            target = users[0];
            accuser = users[4];
            accuser2 = users[5];

            await staking.setPenalty(parseEther("200000"));
            accusationPenalty = await staking.accusationPenalty();
            appealTimespan = await staking.appealTimespan();

            await staking.updateRate(rate);

            await staking
                .connect(users[1])
                .stake(stakeAmount, await getOnlineProof(users[0].address));
            await staking
                .connect(users[2])
                .stake(stakeAmount, await getOnlineProof(users[1].address));

            totalAmount = stakeAmount.mul(2);

            await rewardToken.connect(deployer).mint(accuser.address, accusationPenalty);
            await rewardToken.connect(deployer).mint(accuser2.address, accusationPenalty);
        });

        it("Should accuse by anyone with collateral", async function () {
            await expect(staking.connect(accuser).accuse(target.address)).to.revertedWith(
                "ERC20: transfer amount exceeds allowance"
            );

            await rewardToken.connect(accuser).approve(staking.address, accusationPenalty);
            const tx = await staking.connect(accuser).accuse(target.address);
            const appealTimestamp = await currentTime();
            await expect(tx)
                .to.emit(staking, "Accuse")
                .withArgs(target.address, accuser.address, accusationPenalty, appealTimestamp)
                .to.emit(rewardToken, "Transfer")
                .withArgs(accuser.address, staking.address, accusationPenalty);

            expect(await staking.keeperAccusations(target.address)).to.deep.equal([
                accuser.address,
                accusationPenalty,
                BigNumber.from(appealTimestamp),
            ]);
        });

        it("Should not accuse with not existing keeper", async function () {
            await expect(staking.connect(accuser).accuse(users[3].address)).to.revertedWith(
                "keeper not staking"
            );
        });

        it("Should not accuse twice", async function () {
            await rewardToken.connect(accuser).approve(staking.address, accusationPenalty);
            await staking.connect(accuser).accuse(target.address);

            await rewardToken.connect(accuser2).approve(staking.address, accusationPenalty);
            await expect(staking.connect(accuser2).accuse(target.address)).to.revertedWith(
                "ongoing accusation"
            );
        });

        it("Should accuse and win", async function () {
            expect(await rewardToken.balanceOf(accuser.address)).to.equal(accusationPenalty);

            await rewardToken.connect(accuser).approve(staking.address, accusationPenalty);
            await staking.connect(accuser).accuse(target.address);

            // wait for appeal
            await expect(staking.connect(accuser).winAccusation(target.address)).to.revertedWith(
                "wait for appeal"
            );

            await advanceTimeAndBlock(appealTimespan.toNumber());

            expect(await rewardToken.balanceOf(accuser.address)).to.equal(0);
            expect(await staking.stakes(target.address)).to.equal(stakeAmount);

            await expect(staking.connect(accuser).winAccusation(target.address))
                .to.emit(staking, "AccuseWin")
                .withArgs(target.address, accuser.address, accusationPenalty)
                .to.emit(staking, "Unstake")
                .withArgs(target.address, stakeAmount, 0, 0);

            expect(await staking.stakes(target.address)).to.equal(0);
            expect(await rewardToken.balanceOf(target.address)).to.equal(0);

            // can not accuse twice
            await expect(staking.connect(accuser).winAccusation(target.address)).to.revertedWith(
                "no accusation"
            );

            expect(await rewardToken.balanceOf(accuser.address)).to.equal(accusationPenalty.mul(2));
        });

        it("Should accuse and win, rewards can cover penalty", async function () {
            await advanceBlockAtTime(startTimestamp + WEEK);

            await rewardToken.connect(accuser).approve(staking.address, accusationPenalty);
            await staking.connect(accuser).accuse(target.address);

            await advanceTimeAndBlock(appealTimespan.toNumber());
            await staking.connect(accuser).winAccusation(target.address);

            expect(await staking.stakes(target.address)).to.equal(0);
            const rewards = await calUserRewards(stakeAmount, totalAmount, startTimestamp);

            expect(await rewardToken.balanceOf(target.address)).to.equal(
                rewards.sub(accusationPenalty)
            );
            expect(await staking.keeperPenalties(target.address)).to.equal(0);
        });

        it("Should accuse and win, reward not enough to cover penalty", async function () {
            await advanceBlockAtTime(startTimestamp + DAY);

            await rewardToken.connect(accuser).approve(staking.address, accusationPenalty);
            await staking.connect(accuser).accuse(target.address);

            await advanceTimeAndBlock(appealTimespan.toNumber());
            await staking.connect(accuser).winAccusation(target.address);

            expect(await staking.stakes(target.address)).to.equal(0);

            const rewards = await calUserRewards(stakeAmount, totalAmount, startTimestamp);

            expect(await rewardToken.balanceOf(target.address)).to.equal(0);
            expect(await staking.keeperPenalties(target.address)).to.equal(
                accusationPenalty.sub(rewards)
            );
        });

        it("Should accuse and appeal", async function () {
            await advanceBlockAtTime(startTimestamp + DAY);

            await rewardToken.connect(accuser).approve(staking.address, accusationPenalty);
            await staking.connect(accuser).accuse(target.address);

            const accusationTime = (
                await staking.keeperAccusations(target.address)
            ).timestamp.toNumber();
            expect(accusationTime).to.equal(await currentTime());

            await advanceBlock();

            const wrongProof = await getOnlineProof(target.address);
            await expect(staking.connect(accuser).appeal(wrongProof)).to.revertedWith(
                "out of time"
            );

            const wrongProof2 = await getOnlineProof(target.address);
            wrongProof2.timestamp = accusationTime;
            await expect(staking.connect(accuser).appeal(wrongProof2)).to.revertedWith(
                "invalid signature"
            );

            expect(await rewardToken.balanceOf(accuser.address)).to.equal(0);
            expect(await rewardToken.balanceOf(target.address)).to.equal(0);

            const proof = await getOnlineProof(target.address, accusationTime);
            await expect(staking.connect(target).appeal(proof))
                .to.emit(staking, "AccuseLose")
                .withArgs(target.address, accuser.address, target.address, accusationPenalty);

            expect(await rewardToken.balanceOf(accuser.address)).to.equal(0);
            expect(await rewardToken.balanceOf(target.address)).to.equal(accusationPenalty);

            // appeal twice
            await expect(staking.connect(target).appeal(proof)).to.revertedWith("no accusation");
        });

        it("Should accuse and late for appeal", async function () {
            await rewardToken.connect(accuser).approve(staking.address, accusationPenalty);
            await staking.connect(accuser).accuse(target.address);
            const accusationTime = await currentTime();
            const proof = await getOnlineProof(target.address, accusationTime);

            await advanceTimeAndBlock((await staking.appealTimespan()).toNumber());
            await expect(staking.connect(target).appeal(proof)).to.revertedWith("late for appeal");
        });

        it("Should not stake/unstake/claim during accusation", async function () {
            await rewardToken.connect(accuser).approve(staking.address, accusationPenalty);
            await staking.connect(accuser).accuse(target.address);

            await advanceBlock();

            await expect(
                staking.connect(target).stake(stakeAmount, await getOnlineProof(target.address))
            ).to.revertedWith("ongoing accusation");
            await expect(
                staking.connect(target).unstake(stakeAmount, await getOnlineProof(target.address))
            ).to.revertedWith("ongoing accusation");
            await expect(
                staking.connect(target).claim(await getOnlineProof(target.address))
            ).to.revertedWith("ongoing accusation");

            await advanceTimeAndBlock(WEEK);

            await expect(
                staking.connect(target).stake(stakeAmount, await getOnlineProof(target.address))
            ).to.revertedWith("ongoing accusation");
            await expect(
                staking.connect(target).unstake(stakeAmount, await getOnlineProof(target.address))
            ).to.revertedWith("ongoing accusation");
            await expect(
                staking.connect(target).claim(await getOnlineProof(target.address))
            ).to.revertedWith("ongoing accusation");
        });
    });
});
