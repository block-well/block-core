import { expect } from "chai";
import { BigNumber, Wallet, utils } from "ethers";
import { waffle, ethers, deployments } from "hardhat";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

const { parseEther, parseUnits } = ethers.utils;
const parsePrecise = (value: string) => parseUnits(value, 18);
import { advanceBlockAtTime, advanceTimeAndBlock, currentTime, WEEK, DAY, HOUR } from "./helper";
import { ERC20, StakingUnlock, MockERC20, Airdrop } from "../build/typechain";

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const user0Index0 = 0;
    const claimAmount = parseEther("1600"); //* 10^18

    const [deployer, ...users] = waffle.provider.getWallets();
    const user0Leaf0 = utils.solidityKeccak256(
        ["uint256", "address", "uint256"],
        [user0Index0, users[0].address, claimAmount]
    );

    // const Leaves = [user0Leaf, keccak256('a'), keccak256('b'), keccak256('c')];
    const Leaves = [user0Leaf0].concat(["a", "b", "c"].map((x) => keccak256(x)));
    // console.log(Leaves);

    const merkleTree = new MerkleTree(Leaves, keccak256, { hashLeaves: false, sortPairs: true });
    const merkleRoot = merkleTree.getHexRoot();

    await deployments.deploy("RewardToken", {
        contract: "MockERC20",
        from: deployer.address,
    });
    const rewardToken = (await ethers.getContract("RewardToken")) as MockERC20;

    await deployments.deploy("LpToken", {
        contract: "MockERC20",
        from: deployer.address,
    });
    const stakedToken = (await ethers.getContract("LpToken")) as MockERC20;

    await deployments.deploy("LpToken2", {
        contract: "MockERC20",
        from: deployer.address,
    });
    const stakedToken2 = (await ethers.getContract("LpToken2")) as MockERC20;

    await deployments.deploy("UnknownERC20", {
        contract: "MockERC20",
        from: deployer.address,
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
        args: [stakingUnlock.address, rewardToken.address, merkleRoot, deadline],
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
        Leaves,
        merkleTree,
        user0Index0,
        claimAmount,
    };
});

describe("StakingUnlock", function () {
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
    let Leaves: string[];
    let user0Proof0: string[];

    let merkleTree: MerkleTree;
    let user0Index0: number;
    let claimAmount: BigNumber;

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
            Leaves,
            merkleTree,
            user0Index0,
            claimAmount,
        } = await setupFixture());
        deadline = (await airdrop.deadline()).toNumber();

        minTimespan = 7 * DAY;
        speed = BigNumber.from("1600").mul(PRECISE_UNIT).div(minTimespan); // 1 lp to 1600 dcs

        user0Proof0 = merkleTree.getHexProof(Leaves[0]);
    });

    describe("initialize()", function () {
        it("Should initialize stakingUnlock", async function () {
            expect(await rewardToken.balanceOf(staking.address)).to.equal(0);
            expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);
            expect(await rewardToken.balanceOf(deployer.address)).to.equal(0);

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
        // const claimAmount = parseEther("1600");

        beforeEach(async function () {
            await staking.connect(deployer).setLpConfig(stakedToken.address, speed, minTimespan);
        });

        it("Should add locked via airdrop", async () => {
            expect(await airdrop.claimed(user0Index0)).to.be.false;

            await expect(airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0))
                .to.emit(airdrop, "Claim")
                .withArgs(users[0].address, user0Index0, claimAmount);

            expect(await airdrop.claimed(user0Index0)).to.be.true;
        });

        it("Wrong proof should fail to claim", async () => {
            const user1Proof = merkleTree.getHexProof(Leaves[1]);

            await expect(
                airdrop.connect(users[0]).claim(user0Index0, claimAmount, user1Proof)
            ).to.be.revertedWith("wrong Merkle proof");
        });

        it("Should not issue twice for the same user", async () => {
            await expect(airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0))
                .to.emit(airdrop, "Claim")
                .withArgs(users[0].address, user0Index0, claimAmount);

            await expect(
                airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0)
            ).to.revertedWith("already claimed");
        });

        it("Should update when a new record inserts", async () => {
            await rewardToken.connect(deployer).mint(airdrop.address, parseEther("1000"));

            const user0Index1 = 1;
            const newClaimAmount = parseEther("1000"); //* 10^18

            const user0Leaf1 = utils.solidityKeccak256(
                ["uint256", "address", "uint256"],
                [user0Index1, users[0].address, newClaimAmount]
            );
            Leaves.push(user0Leaf1);

            const newMerkleTree = new MerkleTree(Leaves, keccak256, {
                hashLeaves: false,
                sortPairs: true,
            });
            const newMerkleRoot = newMerkleTree.getHexRoot();

            const newUser0Proof0 = newMerkleTree.getHexProof(Leaves[0]);
            const newUser0Proof1 = newMerkleTree.getHexProof(Leaves[4]);

            await expect(airdrop.connect(deployer).updateMerkleRoot(newMerkleRoot))
                .to.emit(airdrop, "UpdateMerkleRoot")
                .withArgs(newMerkleRoot);

            await expect(airdrop.connect(users[0]).claim(user0Index0, claimAmount, newUser0Proof0))
                .to.emit(airdrop, "Claim")
                .withArgs(users[0].address, user0Index0, claimAmount);

            await expect(
                airdrop.connect(users[0]).claim(user0Index1, newClaimAmount, newUser0Proof1)
            )
                .to.emit(airdrop, "Claim")
                .withArgs(users[0].address, user0Index1, newClaimAmount);
        });

        it("Should not claim after deadline", async () => {
            await advanceBlockAtTime(deadline + DAY);

            await expect(
                airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0)
            ).to.revertedWith("only before deadline");
        });

        it("Should refund after deadline", async () => {
            await expect(airdrop.connect(deployer).refund()).to.revertedWith("only after deadline");

            await advanceBlockAtTime(deadline + 1);

            // await expect(airdrop.connect(users[0]).refund()).to.revertedWith("only owner");

            const balance = await rewardToken.balanceOf(airdrop.address);
            await expect(airdrop.connect(deployer).refund())
                .to.emit(airdrop, "Refund")
                .withArgs(balance);
        });
    });
    describe("StakingUnlock()", function () {
        // const claimAmount = parseEther("1600");

        beforeEach(async function () {
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

                await expect(airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0))
                    .to.emit(staking, "DepositLocked")
                    .withArgs(airdrop.address, users[0].address, claimAmount, 0);

                expect(await staking.userStakeRecord(users[0].address)).to.deep.equal([
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
                await expect(airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0))
                    .to.emit(staking, "DepositLocked")
                    .withArgs(airdrop.address, users[0].address, claimAmount, 0);

                await advanceTimeAndBlock(DAY);

                const lpAmount = parseEther("1");
                await expect(staking.connect(users[0]).stake(stakedToken.address, lpAmount))
                    .to.emit(staking, "Stake")
                    .withArgs(users[0].address, stakedToken.address, lpAmount, 0);

                expect(await staking.connect(users[0]).callStatic.claim()).to.equal(0);
                const maxSpeed = claimAmount.mul(PRECISE_UNIT).div(minTimespan);
                const rec = await staking.userStakeRecord(users[0].address);
                expect(rec.amount).to.equal(lpAmount);
                expect(rec.maxSpeed).to.equal(maxSpeed);
                expect(rec.lastTimestamp).to.equal(await currentTime());
                expect(rec.lp).to.equal(stakedToken.address);

                await advanceTimeAndBlock(HOUR);

                const lpSpeed = lpAmount.mul(speed);
                const unlockAmount = BigNumber.from(await currentTime())
                    .sub(rec.lastTimestamp)
                    .mul(lpSpeed)
                    .div(PRECISE_UNIT);

                expect(await staking.connect(users[0]).callStatic.claim()).to.equal(unlockAmount);
            });

            it("Should unlock & stake before claim", async () => {
                const lpAmount = parseEther("1");
                await expect(staking.connect(users[0]).stake(stakedToken.address, lpAmount))
                    .to.emit(staking, "Stake")
                    .withArgs(users[0].address, stakedToken.address, lpAmount, 0);

                await advanceTimeAndBlock(DAY);

                await expect(airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0))
                    .to.emit(staking, "DepositLocked")
                    .withArgs(airdrop.address, users[0].address, claimAmount, 0);

                expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                expect(await staking.connect(users[0]).callStatic.claim()).to.equal(0);
                const maxSpeed = claimAmount.mul(PRECISE_UNIT).div(minTimespan);
                const rec = await staking.userStakeRecord(users[0].address);
                expect(rec.amount).to.equal(lpAmount);
                expect(rec.maxSpeed).to.equal(maxSpeed);
                expect(rec.lastTimestamp).to.equal(await currentTime());
                expect(rec.lp).to.equal(stakedToken.address);

                await advanceTimeAndBlock(HOUR);

                const lpSpeed = lpAmount.mul(speed);
                const unlockAmount = BigNumber.from(await currentTime())
                    .sub(rec.lastTimestamp)
                    .mul(lpSpeed)
                    .div(PRECISE_UNIT);

                expect(await staking.connect(users[0]).callStatic.claim()).to.equal(unlockAmount);
            });

            it("Should claim all in minTimespan", async () => {
                await airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0);
                expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                const lpAmount = parseEther("1");
                await staking.connect(users[0]).stake(stakedToken.address, lpAmount);

                const endTimestamp = (await currentTime()) + WEEK;
                await advanceBlockAtTime(endTimestamp);

                await staking.connect(users[0]).claim();

                expect(await staking.userLocked(users[0].address)).to.equal(0);
            });

            it("Should extend finish time if stake", async () => {
                expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);

                await airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0);
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
                    await airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0);
                });

                it("Unlock capped by lp speed", async () => {
                    const lpAmount = parseEther("0.5");
                    await staking.connect(users[0]).stake(stakedToken.address, lpAmount);
                    expect(await staking.userLocked(users[0].address)).to.equal(claimAmount);

                    await advanceTimeAndBlock(HOUR);

                    const rec = await staking.userStakeRecord(users[0].address);
                    const cappedSpeed = rec.amount.mul(speed);
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
                    await airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0);
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
                        .mul(lpAmount.mul(speed)) // maxSpeed has numerical issue
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
                await airdrop.connect(users[0]).claim(user0Index0, claimAmount, user0Proof0);
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
