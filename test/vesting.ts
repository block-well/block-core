import { expect } from "chai";
import { BigNumber, Wallet } from "ethers";
import { waffle, ethers, deployments } from "hardhat";
const { parseEther } = ethers.utils;
import { advanceBlockAtTime, advanceTimeAndBlock, currentTime, WEEK } from "./helper";
import { ERC20, Vesting, MockERC20 } from "../build/typechain";

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    // await deployments.fixture();

    const [deployer, ...users] = waffle.provider.getWallets();

    await deployments.deploy("RewardToken", {
        contract: "MockERC20",
        from: deployer.address,
    });
    const rewardToken = (await ethers.getContract("RewardToken")) as MockERC20;

    await deployments.deploy("Vesting", {
        from: deployer.address,
        args: [rewardToken.address],
    });
    const vesting = (await ethers.getContract("Vesting")) as Vesting;

    await rewardToken.connect(deployer).mint(deployer.address, parseEther("10000"));

    return {
        users,
        deployer,
        rewardToken,
        vesting,
    };
});

function getVestedSupply(
    total: BigNumber,
    initial: BigNumber,
    currTime: number,
    startTime: number,
    endTime: number
) {
    return total
        .sub(initial)
        .mul(currTime - startTime)
        .div(endTime - startTime)
        .add(initial);
}

describe("StakingUnlock", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let rewardToken: ERC20;
    let vesting: Vesting;

    beforeEach(async function () {
        ({ deployer, users, rewardToken, vesting } = await setupFixture());
    });

    describe("initialize()", function () {
        it("Should initialize", async function () {
            expect(await vesting.vestedSupply(users[0].address)).to.equal(0);
            expect(await vesting.lockedSupply(users[0].address)).to.equal(0);
        });
    });

    describe("AddVesting()", function () {
        const totalVesting = parseEther("1000");
        let startTimestamp: number;
        let endTimestamp: number;

        beforeEach(async function () {
            startTimestamp = (await currentTime()) + WEEK;
            endTimestamp = startTimestamp + 4 * WEEK;
        });

        it("Should add vesting", async () => {
            await expect(
                vesting
                    .connect(users[0])
                    .addVesting(users[0].address, startTimestamp, endTimestamp, totalVesting, 0)
            ).to.revertedWith("Ownable: caller is not the owner");

            await expect(
                vesting
                    .connect(deployer)
                    .addVesting(
                        users[0].address,
                        startTimestamp,
                        endTimestamp,
                        totalVesting,
                        totalVesting
                    )
            ).to.revertedWith("invalid initialClaimable");

            await rewardToken.connect(deployer).approve(vesting.address, totalVesting);
            await expect(
                vesting
                    .connect(deployer)
                    .addVesting(users[0].address, startTimestamp, endTimestamp, totalVesting, 0)
            )
                .emit(vesting, "AddVesting")
                .withArgs(users[0].address, startTimestamp, endTimestamp, totalVesting, 0);

            const data = await vesting.userVesting(users[0].address);
            expect(data.startTimestamp).to.equal(startTimestamp);
            expect(data.endTimestamp).to.equal(endTimestamp);
            expect(data.totalVesting).to.equal(totalVesting);
            expect(data.totalClaimed).to.equal(0);
            expect(data.initialClaimable).to.equal(0);
            expect(data.pausedTimestamp).to.equal(0);
        });
    });

    describe("Claim()", function () {
        const totalVesting1 = parseEther("1000");
        const initialClaimable1 = parseEther("0");
        let startTimestamp1: number;
        let endTimestamp1: number;

        const totalVesting2 = parseEther("2500");
        const initialClaimable2 = parseEther("500");
        let startTimestamp2: number;
        let endTimestamp2: number;

        beforeEach(async function () {
            startTimestamp1 = (await currentTime()) + WEEK;
            endTimestamp1 = startTimestamp1 + 4 * WEEK;

            startTimestamp2 = (await currentTime()) + 2 * WEEK;
            endTimestamp2 = startTimestamp2 + 4 * WEEK;

            await rewardToken.connect(deployer).approve(vesting.address, totalVesting1);
            await vesting.addVesting(
                users[0].address,
                startTimestamp1,
                endTimestamp1,
                totalVesting1,
                initialClaimable1
            );

            await rewardToken.connect(deployer).approve(vesting.address, totalVesting2);
            await vesting.addVesting(
                users[1].address,
                startTimestamp2,
                endTimestamp2,
                totalVesting2,
                initialClaimable2
            );
        });

        it("Should not claim before startTimestamp", async () => {
            expect(await vesting.connect(users[0]).callStatic.claim()).to.equal(0);
            expect(await vesting.connect(users[1]).callStatic.claim()).to.equal(0);
            expect(await vesting.connect(users[2]).callStatic.claim()).to.equal(0);

            expect(await rewardToken.balanceOf(users[0].address)).to.equal(0);
        });

        it("Should claim after 1 week", async () => {
            await advanceBlockAtTime(startTimestamp1 + WEEK);

            const tx = await vesting.connect(users[0]).claim();
            const amount1 = getVestedSupply(
                totalVesting1,
                initialClaimable1,
                await currentTime(),
                startTimestamp1,
                endTimestamp1
            );
            expect(tx).to.emit(vesting, "Claim").withArgs(users[0].address, amount1);
            expect(await rewardToken.balanceOf(users[0].address)).to.equal(amount1);

            const amount2 = getVestedSupply(
                totalVesting2,
                initialClaimable2,
                await currentTime(),
                startTimestamp2,
                endTimestamp2
            );
            expect(await vesting.connect(users[1]).callStatic.claim()).to.equal(amount2);

            // claim twice
            await advanceTimeAndBlock(WEEK);
            const tx2 = await vesting.connect(users[0]).claim();
            expect(tx2)
                .to.emit(vesting, "Claim")
                .withArgs(
                    users[0].address,
                    getVestedSupply(
                        totalVesting1,
                        initialClaimable1,
                        await currentTime(),
                        startTimestamp1,
                        endTimestamp1
                    ).sub(amount1)
                );
        });

        it("Should claim after 2 week", async () => {
            await advanceBlockAtTime(startTimestamp1 + 2 * WEEK);

            const amount1 = getVestedSupply(
                totalVesting1,
                initialClaimable1,
                await currentTime(),
                startTimestamp1,
                endTimestamp1
            );
            expect(await vesting.connect(users[0]).callStatic.claim()).to.equal(amount1);
            const amount2 = getVestedSupply(
                totalVesting2,
                initialClaimable2,
                await currentTime(),
                startTimestamp2,
                endTimestamp2
            );

            expect(await vesting.vestedSupply(users[1].address)).to.equal(amount2);
            expect(await vesting.connect(users[1]).callStatic.claim()).to.equal(amount2);
        });

        it("Should claim all after endTime", async () => {
            await advanceBlockAtTime(startTimestamp1 + 10 * WEEK);

            await expect(vesting.connect(users[0]).claim())
                .to.emit(vesting, "Claim")
                .withArgs(users[0].address, totalVesting1);
            await expect(vesting.connect(users[1]).claim())
                .to.emit(vesting, "Claim")
                .withArgs(users[1].address, totalVesting2);
        });
    });
    describe("Pause()", function () {
        const totalVesting = parseEther("1000");
        const initialClaimable = parseEther("0");
        let startTimestamp: number;
        let endTimestamp: number;

        beforeEach(async function () {
            startTimestamp = (await currentTime()) + WEEK;
            endTimestamp = startTimestamp + 4 * WEEK;

            await rewardToken.connect(deployer).approve(vesting.address, totalVesting);
            await vesting.addVesting(
                users[0].address,
                startTimestamp,
                endTimestamp,
                totalVesting,
                initialClaimable
            );
        });

        it("Check permission", async () => {
            await expect(vesting.connect(users[0]).togglePause(users[0].address)).to.revertedWith(
                "Ownable: caller is not the owner"
            );
            expect((await vesting.userVesting(users[0].address)).pausedTimestamp).to.equal(0);

            const tx = await vesting.connect(deployer).togglePause(users[0].address);
            const currentTimestamp = await currentTime();
            expect(tx).to.emit(vesting, "TogglePause").withArgs(users[0].address, currentTimestamp);

            expect((await vesting.userVesting(users[0].address)).pausedTimestamp).to.equal(
                currentTimestamp
            );
        });

        it("Should pause and claim some", async () => {
            await advanceBlockAtTime(startTimestamp + 2 * WEEK);

            // toggle
            const tx = await vesting.connect(deployer).togglePause(users[0].address);
            const currentTimestamp = await currentTime();
            expect(tx).to.emit(vesting, "TogglePause").withArgs(users[0].address, currentTimestamp);

            const claimAmount1 = getVestedSupply(
                totalVesting,
                initialClaimable,
                currentTimestamp,
                startTimestamp,
                endTimestamp
            );
            expect(await vesting.connect(users[0]).callStatic.claim()).to.equal(claimAmount1);
            expect((await vesting.userVesting(users[0].address)).pausedTimestamp).to.equal(
                currentTimestamp
            );

            // claim
            const tx2 = await vesting.connect(users[0]).claim();
            const claimAmount2 = getVestedSupply(
                totalVesting,
                initialClaimable,
                currentTimestamp,
                startTimestamp,
                endTimestamp
            );
            expect(tx2).to.emit(vesting, "Claim").withArgs(users[0].address, claimAmount2);

            // toggle paused
            await advanceTimeAndBlock(WEEK);
            await vesting.connect(deployer).togglePause(users[0].address);

            const tx3 = await vesting.connect(users[0]).claim();
            const claimAmount3 = getVestedSupply(
                totalVesting,
                initialClaimable,
                await currentTime(),
                startTimestamp,
                endTimestamp
            ).sub(claimAmount2);
            expect(tx3).to.emit(vesting, "Claim").withArgs(users[0].address, claimAmount3);
        });
    });
});
