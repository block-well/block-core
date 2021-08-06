import { expect } from "chai";
import { BigNumber, Wallet } from "ethers";
import { waffle, ethers, deployments } from "hardhat";
const { parseEther, parseUnits } = ethers.utils;
const parsePrecise = (value: string) => parseUnits(value, 18);
import { advanceBlockAtTime, advanceTimeAndBlock, currentTime, WEEK, DAY, HOUR } from "./helper";
import { ERC20, DCS, StakingUnlock, MockERC20, Airdrop } from "../build/typechain";

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer, ...users] = waffle.provider.getWallets();

    await deployments.deploy("DCS", {
        from: deployer.address,
        log: true,
    });
    const rewardToken = (await ethers.getContract("DCS")) as DCS;

    await deployments.deploy("LpToken", {
        contract: "MockERC20",
        from: deployer.address,
        log: true,
    });
    const stakedToken = (await ethers.getContract("LpToken")) as MockERC20;

    await deployments.deploy("LpToken2", {
        contract: "MockERC20",
        from: deployer.address,
        log: true,
    });
    const stakedToken2 = (await ethers.getContract("LpToken2")) as MockERC20;

    await deployments.deploy("UnknownERC20", {
        contract: "MockERC20",
        from: deployer.address,
        log: true,
    });
    const unknownToken = (await ethers.getContract("UnknownERC20")) as MockERC20;

    await deployments.deploy("StakingUnlock", {
        from: deployer.address,
        args: [rewardToken.address],
    });
    const stakingUnlock = (await ethers.getContract("StakingUnlock")) as StakingUnlock;

    const currentTimestamp = await currentTime();
    const deadline = currentTimestamp + 10 * WEEK;

    await deployments.deploy("Airdrop", {
        from: deployer.address,
        args: [stakingUnlock.address, rewardToken.address, ethers.constants.HashZero, deadline],
    });
    const airdrop = (await ethers.getContract("Airdrop")) as Airdrop;

    await rewardToken.connect(deployer).mint(airdrop.address, parseEther("1600"));
    await stakedToken.connect(deployer).mint(users[0].address, parseEther("100"));
    await stakedToken2.connect(deployer).mint(users[0].address, parseEther("100"));
    await unknownToken.connect(deployer).mint(users[0].address, parseEther("1000"));

    await stakedToken.connect(users[0]).approve(stakingUnlock.address, parseEther("100"));
    await stakedToken2.connect(users[0]).approve(stakingUnlock.address, parseEther("100"));

    return {
        users,
        deployer,
        rewardToken,
        stakedToken,
        stakedToken2,
        stakingUnlock,
        unknownToken,
        airdrop,
    };
});

describe("Staking", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let rewardToken: ERC20;
    let stakedToken: ERC20;
    let stakedToken2: ERC20;
    let unknownToken: ERC20;
    let staking: StakingUnlock;
    let airdrop: Airdrop;
    let deadline: number;
    let speed: BigNumber;
    let minTimespan: number;
    const PRECISE_UNIT = parsePrecise("1");

    beforeEach(async function () {
        ({
            deployer,
            users,
            rewardToken,
            stakedToken,
            stakedToken2,
            unknownToken,
            stakingUnlock: staking,
            airdrop,
        } = await setupFixture());
        deadline = (await airdrop.deadline()).toNumber();

        minTimespan = 7 * DAY;
        speed = BigNumber.from("1600").mul(PRECISE_UNIT).div(minTimespan); // 1 lp to 1600 dcs
    });

    describe("initialize()", function () {
        it("Should initialize stakingUnlock", async function () {
            expect(await rewardToken.balanceOf(staking.address)).to.equal(0);

            await expect(
                staking.connect(deployer).setLpConfig(stakedToken.address, speed, minTimespan)
            )
                .to.emit(staking, "SetLpConfig")
                .withArgs(stakedToken.address, speed, minTimespan);

            await expect(
                staking.connect(deployer).setLpConfig(stakedToken2.address, speed, minTimespan)
            )
                .to.emit(staking, "SetLpConfig")
                .withArgs(stakedToken2.address, speed, minTimespan);
        });
    });

    describe("Airdrop()", function () {
        const claimAmount = parseEther("1600");

        beforeEach(async function () {
            const ISSUER_ROLE = await staking.ISSUER_ROLE();
            await staking.connect(deployer).grantRole(ISSUER_ROLE, airdrop.address);

            await staking.connect(deployer).setLpConfig(stakedToken.address, speed, minTimespan);
        });

        it("Should add locked via issuer", async () => {
            expect(await airdrop.claimed(users[0].address)).to.be.false;

            await expect(
                staking.connect(deployer).depositLocked(users[0].address, parseEther("1"))
            ).to.revertedWith("only issuer");

            await expect(airdrop.connect(users[0]).claim())
                .to.emit(airdrop, "Claim")
                .withArgs(users[0].address, claimAmount);

            expect(await airdrop.claimed(users[0].address)).to.be.true;
        });

        it("Should not issue twice for the same user", async () => {
            await expect(airdrop.connect(users[0]).claim())
                .to.emit(airdrop, "Claim")
                .withArgs(users[0].address, claimAmount);

            await expect(airdrop.connect(users[0]).claim()).to.revertedWith("already claimed");
        });

        it("Should not claim after deadline", async () => {
            await advanceBlockAtTime(deadline + DAY);

            await expect(airdrop.connect(users[0]).claim()).to.revertedWith("only before deadline");
        });

        it("Should refund after deadline", async () => {
            await expect(airdrop.connect(deployer).refund()).to.revertedWith("only after deadline");

            await advanceBlockAtTime(deadline + 1);

            await expect(airdrop.connect(users[0]).refund()).to.revertedWith("only owner");

            const balance = await rewardToken.balanceOf(airdrop.address);
            await expect(airdrop.connect(deployer).refund())
                .to.emit(airdrop, "Refund")
                .withArgs(deployer.address, balance);
        });
    });
    describe("StakingUnlock()", function () {
        const claimAmount = parseEther("1600");

        beforeEach(async function () {
            const ISSUER_ROLE = await staking.ISSUER_ROLE();

            await staking.connect(deployer).grantRole(ISSUER_ROLE, airdrop.address);
            await staking.connect(deployer).setLpConfig(stakedToken.address, speed, minTimespan);
        });

        describe("stake()", function () {
            it("stake unkown token", async () => {
                const lpAmount = parseEther("1");
                await expect(
                    staking.connect(users[0]).stake(unknownToken.address, lpAmount)
                ).to.revertedWith("unknown stake token");
            });

            it("zero address token", async () => {
                const lpAmount = parseEther("1");
                await expect(
                    staking.connect(users[0]).stake(ethers.constants.AddressZero, lpAmount)
                ).to.revertedWith("unknown stake token");
            });

            it("stake two different lp token", async () => {
                const lpAmount = parseEther("1");
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                await staking
                    .connect(deployer)
                    .setLpConfig(stakedToken2.address, speed, minTimespan);

                await expect(
                    staking.connect(users[0]).stake(stakedToken2.address, lpAmount)
                ).to.revertedWith("lp unmatched");
            });

            it("Should stake", async () => {
                const lpAmount = parseEther("1");
                const balance = await stakedToken.balanceOf(users[0].address);

                await expect(staking.connect(users[0]).stake(stakedToken.address, lpAmount))
                    .to.emit(staking, "Stake")
                    .withArgs(users[0].address, stakedToken.address, lpAmount, 0);

                expect(await stakedToken.balanceOf(users[0].address)).to.equal(
                    balance.sub(lpAmount)
                );
                expect(await stakedToken.balanceOf(staking.address)).to.equal(lpAmount);
            });

            it("Should not unlock if no stake", async () => {
                expect(await staking.userLocked(users[0].address)).to.equal(0);

                await expect(airdrop.connect(users[0]).claim())
                    .to.emit(staking, "DepositLocked")
                    .withArgs(airdrop.address, users[0].address, claimAmount, 0);

                expect(await staking.userStakeRecord(users[0].address)).to.deep.equal([
                    BigNumber.from(0),
                    BigNumber.from(0),
                    BigNumber.from(0),
                    BigNumber.from(await currentTime()),
                    ethers.constants.AddressZero,
                ]);

                await expect(staking.connect(users[0]).claim()).to.revertedWith("no stake token");

                expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                await advanceTimeAndBlock(WEEK);

                await expect(staking.connect(users[0]).claim()).to.revertedWith("no stake token");

                expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);
            });

            it("Should unlock & stake after claim", async () => {
                await expect(airdrop.connect(users[0]).claim())
                    .to.emit(staking, "DepositLocked")
                    .withArgs(airdrop.address, users[0].address, claimAmount, 0);

                await advanceTimeAndBlock(DAY);

                const lpAmount = parseEther("1");
                await expect(staking.connect(users[0]).stake(stakedToken.address, lpAmount))
                    .to.emit(staking, "Stake")
                    .withArgs(users[0].address, stakedToken.address, lpAmount, 0);

                expect(await staking.connect(users[0]).callStatic.claim()).to.equal(0);
                const maxSpeed = claimAmount.mul(PRECISE_UNIT).div(minTimespan);
                const lpSpeed = lpAmount.mul(speed);
                const rec = await staking.userStakeRecord(users[0].address);
                expect(rec.amount).to.equal(lpAmount);
                expect(rec.lpSpeed).to.equal(lpSpeed);
                expect(rec.maxSpeed).to.equal(maxSpeed);
                expect(rec.lastTimestamp).to.equal(await currentTime());
                expect(rec.lp).to.equal(stakedToken.address);

                await advanceTimeAndBlock(HOUR);

                const unlockAmount = BigNumber.from(await currentTime())
                    .sub(rec.lastTimestamp)
                    .mul(rec.lpSpeed)
                    .div(PRECISE_UNIT);

                expect(await staking.connect(users[0]).callStatic.claim()).to.equal(unlockAmount);
            });

            it("Should unlock & stake before claim", async () => {
                const lpAmount = parseEther("1");
                await expect(staking.connect(users[0]).stake(stakedToken.address, lpAmount))
                    .to.emit(staking, "Stake")
                    .withArgs(users[0].address, stakedToken.address, lpAmount, 0);

                await advanceTimeAndBlock(DAY);

                await expect(airdrop.connect(users[0]).claim())
                    .to.emit(staking, "DepositLocked")
                    .withArgs(airdrop.address, users[0].address, claimAmount, 0);

                expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                expect(await staking.connect(users[0]).callStatic.claim()).to.equal(0);
                const maxSpeed = claimAmount.mul(PRECISE_UNIT).div(minTimespan);
                const lpSpeed = lpAmount.mul(speed);
                const rec = await staking.userStakeRecord(users[0].address);
                expect(rec.amount).to.equal(lpAmount);
                expect(rec.lpSpeed).to.equal(lpSpeed);
                expect(rec.maxSpeed).to.equal(maxSpeed);
                expect(rec.lastTimestamp).to.equal(await currentTime());
                expect(rec.lp).to.equal(stakedToken.address);

                await advanceTimeAndBlock(HOUR);

                const unlockAmount = BigNumber.from(await currentTime())
                    .sub(rec.lastTimestamp)
                    .mul(rec.lpSpeed)
                    .div(PRECISE_UNIT);

                expect(await staking.connect(users[0]).callStatic.claim()).to.equal(unlockAmount);
            });

            it("Should claim all in minTimespan", async () => {
                await airdrop.connect(users[0]).claim();
                expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                const lpAmount = parseEther("1");
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                const endTimestamp = (await currentTime()) + WEEK;
                await advanceBlockAtTime(endTimestamp);

                await staking.connect(users[0]).claim();

                expect(await staking.userLocked(users[0].address)).to.equal(0);
            });

            it("Should extend finish time if stake", async () => {
                await airdrop.connect(users[0]).claim();
                expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                const lpAmount = parseEther("1");
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);

                const lastMaxSpeed = (await staking.userStakeRecord(users[0].address)).maxSpeed;

                const endTimestamp = (await currentTime()) + WEEK;
                await advanceTimeAndBlock(DAY);
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                // unlock is extended
                const currMaxSpeed = (await staking.userStakeRecord(users[0].address)).maxSpeed;
                expect(currMaxSpeed).to.lt(lastMaxSpeed);
                expect(await rewardToken.balanceOf(users[0].address)).to.gt(0);

                await advanceBlockAtTime(endTimestamp);
                await staking.connect(users[0]).claim();

                // unlock not done
                expect(await rewardToken.balanceOf(users[0].address)).to.lt(claimAmount);
                expect(await staking.userLocked(users[0].address)).to.gt(0);

                await advanceTimeAndBlock(DAY);
                await staking.connect(users[0]).claim();

                // unlock done
                expect(await rewardToken.balanceOf(users[0].address)).to.equal(claimAmount);
                expect(await staking.userLocked(users[0].address)).to.equal(0);
            });

            describe("speed()", function () {
                beforeEach(async function () {
                    await airdrop.connect(users[0]).claim();
                });

                it("Unlock capped by lp speed", async () => {
                    const lpAmount = parseEther("0.5");
                    await staking.connect(users[0]).stake(stakedToken.address, lpAmount);
                    expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                    await advanceTimeAndBlock(HOUR);

                    const rec = await staking.userStakeRecord(users[0].address);
                    const cappedSpeed = rec.lpSpeed;
                    const unlockAmount = BigNumber.from(await currentTime())
                        .sub(rec.lastTimestamp)
                        .mul(cappedSpeed)
                        .div(PRECISE_UNIT);

                    expect(await staking.connect(users[0]).callStatic.claim()).to.equal(
                        unlockAmount
                    );
                });

                it("Unlock capped by max speed", async () => {
                    const lpAmount = parseEther("100");
                    await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                    await advanceTimeAndBlock(HOUR);

                    const rec = await staking.userStakeRecord(users[0].address);
                    const cappedSpeed = rec.maxSpeed;
                    const unlockAmount = BigNumber.from(await currentTime())
                        .sub(rec.lastTimestamp)
                        .mul(cappedSpeed)
                        .div(PRECISE_UNIT);

                    expect(await staking.connect(users[0]).callStatic.claim()).to.equal(
                        unlockAmount
                    );

                    await advanceTimeAndBlock(minTimespan);
                });
            });

            describe("claim()", function () {
                beforeEach(async function () {
                    await airdrop.connect(users[0]).claim();
                });

                it("Check state after claim", async () => {
                    const lpAmount = parseEther("1");
                    await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                    await advanceTimeAndBlock(HOUR);

                    expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);
                    expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);

                    const rec = await staking.userStakeRecord(users[0].address);
                    const tx = await staking.connect(users[0]).claim();
                    const unlockAmount = BigNumber.from(await currentTime())
                        .sub(rec.lastTimestamp)
                        .mul(rec.lpSpeed) // maxSpeed has numerical issue
                        .div(PRECISE_UNIT);

                    await expect(tx)
                        .to.emit(staking, "Claim")
                        .withArgs(users[0].address, stakedToken.address, lpAmount, unlockAmount);

                    expect(await staking.userLocked(users[0].address)).to.equal(
                        claimAmount.sub(unlockAmount)
                    );
                    expect(await rewardToken.balanceOf(users[0].address)).to.equal(unlockAmount);
                });

                it("claim does not affect endtime", async () => {
                    const lpAmount = parseEther("100");
                    await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                    const endTimestamp = (await currentTime()) + minTimespan;

                    await advanceTimeAndBlock(HOUR);

                    const rec = await staking.userStakeRecord(users[0].address);
                    await staking.connect(users[0]).claim();
                    const unlockAmount = BigNumber.from(await currentTime())
                        .sub(rec.lastTimestamp)
                        .mul(rec.maxSpeed)
                        .div(PRECISE_UNIT);

                    expect(await staking.userLocked(users[0].address)).to.equal(
                        claimAmount.sub(unlockAmount)
                    );
                    expect(await rewardToken.balanceOf(users[0].address)).to.equal(unlockAmount);

                    await advanceTimeAndBlock(endTimestamp);

                    await staking.connect(users[0]).claim();

                    expect(await staking.userLocked(users[0].address)).to.equal(0);
                    expect(await rewardToken.balanceOf(users[0].address)).to.equal(claimAmount);
                });

                it("claim total after minTimespan", async () => {
                    const lpAmount = parseEther("100");
                    await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                    const endTime = (await currentTime()) + minTimespan;
                    await advanceBlockAtTime(endTime);

                    await expect(staking.connect(users[0]).claim())
                        .to.emit(staking, "Claim")
                        .withArgs(users[0].address, stakedToken.address, lpAmount, claimAmount);
                });
            });
        });

        describe("unstake()", function () {
            beforeEach(async function () {
                await airdrop.connect(users[0]).claim();
            });

            it("Should unstake", async () => {
                const lpAmount = parseEther("100");
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                await advanceTimeAndBlock(DAY);

                const balanceStaking = await stakedToken.balanceOf(staking.address);
                const balanceUser = await stakedToken.balanceOf(users[0].address);

                await staking.connect(users[0]).unstake(stakedToken.address, lpAmount);

                expect(await stakedToken.balanceOf(staking.address)).to.equal(
                    balanceStaking.sub(lpAmount)
                );
                expect(await stakedToken.balanceOf(users[0].address)).to.equal(
                    balanceUser.add(lpAmount)
                );
            });

            it("Should get reward when unstake", async () => {
                const lpAmount = parseEther("100");
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                await advanceTimeAndBlock(DAY);

                expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);
                await staking.connect(users[0]).unstake(stakedToken.address, lpAmount);
                expect(await rewardToken.balanceOf(users[0].address)).to.gt(0);
            });

            it("Should extend endtime when unstake", async () => {
                expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                const lpAmount = parseEther("2");
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);

                const lastMaxSpeed = (await staking.userStakeRecord(users[0].address)).maxSpeed;

                const endTimestamp = (await currentTime()) + WEEK;
                await advanceTimeAndBlock(DAY);
                await staking.connect(users[0]).unstake(stakedToken.address, lpAmount.div(2));

                // unlock is extended
                const currMaxSpeed = (await staking.userStakeRecord(users[0].address)).maxSpeed;
                expect(currMaxSpeed).to.lt(lastMaxSpeed);
                expect(await rewardToken.balanceOf(users[0].address)).to.gt(0);

                await advanceBlockAtTime(endTimestamp);
                await staking.connect(users[0]).claim();

                // unlock not done
                expect(await rewardToken.balanceOf(users[0].address)).to.lt(claimAmount);
                expect(await staking.userLocked(users[0].address)).to.gt(0);

                await advanceTimeAndBlock(DAY);
                await staking.connect(users[0]).claim();

                // unlock done
                expect(await rewardToken.balanceOf(users[0].address)).to.equal(claimAmount);
                expect(await staking.userLocked(users[0].address)).to.equal(0);
            });

            it("Should stake different lp when fully unstaked", async () => {
                const lpAmount = parseEther("100");
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                await advanceTimeAndBlock(DAY);

                expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);
                await staking.connect(users[0]).unstake(stakedToken.address, lpAmount);
                expect(await rewardToken.balanceOf(users[0].address)).to.gt(0);

                await staking
                    .connect(deployer)
                    .setLpConfig(stakedToken2.address, speed, minTimespan);

                const rec = await staking.userStakeRecord(users[0].address);
                const tx = await staking.connect(users[0]).stake(stakedToken2.address, lpAmount);
                const unlockAmount = BigNumber.from(await currentTime())
                    .sub(rec.lastTimestamp)
                    .mul(rec.maxSpeed)
                    .div(PRECISE_UNIT);
                await expect(tx)
                    .to.emit(staking, "Stake")
                    .withArgs(users[0].address, stakedToken2.address, lpAmount, unlockAmount);
            });
        });
    });
});
