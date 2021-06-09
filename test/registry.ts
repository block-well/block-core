import { expect } from "chai";
import { Wallet } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
import { KeeperRegistry, ERC20, BtcRater } from "../build/typechain";

const { parseEther, parseUnits } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
const parseBtcInCong = (value: string) => parseUnits(value, 18);
const BTC_TO_CONG = 1e8;

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer

    await deployments.deploy("MockWBTC", {
        from: deployer.address,
        log: true,
    });
    const wbtc = (await ethers.getContract("MockWBTC")) as ERC20;

    await deployments.deploy("CONG", {
        from: deployer.address,
        log: true,
    });
    await deployments.execute(
        "CONG",
        { from: deployer.address, log: true },
        "grantRole",
        ethers.utils.id("MINTER_ROLE"),
        deployer.address
    );
    const cong = (await ethers.getContract("CONG")) as ERC20;

    await deployments.deploy("MockHBTC", {
        contract: "MockERC20",
        from: deployer.address,
        log: true,
    });
    const hbtc = (await ethers.getContract("MockHBTC")) as ERC20;

    await deployments.deploy("BtcRater", {
        from: deployer.address,
        args: [
            [wbtc.address, hbtc.address],
            [1, 1],
        ],
        log: true,
    });

    const rater = (await ethers.getContract("BtcRater")) as BtcRater;

    await deployments.deploy("KeeperRegistry", {
        from: deployer.address,
        args: [[wbtc.address, hbtc.address], cong.address, rater.address],
        log: true,
    });
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;

    for (const user of users) {
        await wbtc.mint(user.address, parseBtc("100"));
        await hbtc.mint(user.address, parseEther("100"));
        await cong.connect(deployer).mint(user.address, parseBtcInCong("100"));

        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await hbtc.connect(user).approve(registry.address, parseEther("100"));
        await cong.connect(user).approve(registry.address, parseBtcInCong("100"));
    }

    return { users, deployer, wbtc, hbtc, cong, registry, rater };
});

describe("KeeperRegistry", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let wbtc: ERC20;
    let hbtc: ERC20;
    let cong: ERC20;
    let rater: BtcRater;
    let registry: KeeperRegistry;

    beforeEach(async function () {
        ({ users, deployer, wbtc, hbtc, cong, registry, rater } = await setupFixture());
    });

    describe("addAsset()", function () {
        it("should add asset", async function () {
            const MockWBTC = await ethers.getContractFactory("MockWBTC");
            const wbtc2 = await MockWBTC.connect(deployer).deploy();

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const hbtc2 = await MockERC20.connect(deployer).deploy();

            await expect(registry.connect(deployer).addAsset(wbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(wbtc2.address);

            await expect(registry.connect(deployer).addAsset(hbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(hbtc2.address);
        });
    });

    describe("addKeeper()", function () {
        it("not enough collateral", async function () {
            const amount = parseBtc("0.00001");
            const asset = wbtc.address;
            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(0);

            await expect(registry.connect(users[0]).addKeeper(asset, amount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, asset, amount);
        });

        it("should add keeper", async function () {
            const amount = parseBtc("10");
            const asset = wbtc.address;

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[0].address, hbtc.address)).to.be.equal(0);
            expect(await wbtc.balanceOf(users[0].address)).to.be.equal(parseBtc("100"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("0"));
            expect(await hbtc.balanceOf(users[0].address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);

            await expect(registry.connect(users[0]).addKeeper(asset, amount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, asset, amount);

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(users[0].address, hbtc.address)).to.be.equal(0);
            expect(await wbtc.balanceOf(users[0].address)).to.be.equal(parseBtc("90"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("10"));
            expect(await hbtc.balanceOf(users[0].address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);
        });

        it("import keepers", async function () {
            const amount = parseBtc("10");
            const asset = wbtc;
            const keepers = [users[0], users[1]];
            const keeperAddresses = keepers.map((x) => x.address);
            const auction = deployer;
            for (const keeper of keepers) {
                await asset.connect(keeper).transfer(auction.address, amount);
            }

            const transferAmount = amount.mul(keepers.length);
            await asset.connect(auction).approve(registry.address, transferAmount);
            expect(await asset.balanceOf(auction.address)).to.be.equal(transferAmount);

            await expect(
                registry.connect(auction).importKeepers(amount, asset.address, keeperAddresses)
            )
                .to.emit(registry, "KeeperImported")
                .withArgs(auction.address, asset.address, keeperAddresses, amount);

            expect(await asset.balanceOf(registry.address)).to.be.equal(transferAmount);
            expect(await asset.balanceOf(auction.address)).to.be.equal(0);
            for (const keeper of keepers) {
                expect(await registry.collaterals(keeper.address, asset.address)).to.be.equal(
                    parseEther("10")
                );
            }
        });

        it("import keepers hbtc", async function () {
            const amount = parseEther("10");
            const asset = hbtc;
            const keepers = [users[0], users[1]];
            const keeperAddresses = keepers.map((x) => x.address);
            const auction = deployer;
            for (const keeper of keepers) {
                await asset.connect(keeper).transfer(auction.address, amount);
            }

            const transferAmount = amount.mul(keepers.length);
            await asset.connect(auction).approve(registry.address, transferAmount);
            expect(await asset.balanceOf(auction.address)).to.be.equal(transferAmount);

            await expect(
                registry.connect(auction).importKeepers(amount, asset.address, keeperAddresses)
            )
                .to.emit(registry, "KeeperImported")
                .withArgs(auction.address, asset.address, keeperAddresses, amount);

            expect(await asset.balanceOf(registry.address)).to.be.equal(transferAmount);
            expect(await asset.balanceOf(auction.address)).to.be.equal(0);
            for (const keeper of keepers) {
                expect(await registry.collaterals(keeper.address, asset.address)).to.be.equal(
                    amount
                );
            }
        });
    });

    describe("punishKeeper()", function () {
        beforeEach(async function () {
            await registry.connect(deployer).addAsset(cong.address);
            await rater.connect(deployer).updateRates(cong.address, BTC_TO_CONG);
        });

        it("should punish keeper using non-CONG assets", async function () {
            await registry.connect(users[0]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[1]).addKeeper(hbtc.address, parseEther("10"));

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(users[1].address, hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(0);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await registry.connect(deployer).punishKeeper([users[0].address], parseEther("7"));

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[1].address, hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("7"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await registry.connect(deployer).punishKeeper([users[1].address], parseEther("5"));

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[1].address, hbtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("12"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
            expect(await registry.confiscations(hbtc.address)).to.be.equal(parseEther("10"));
        });

        it("should punish cong keeper and confiscate the rest", async function () {
            await registry.connect(users[0]).addKeeper(cong.address, parseBtcInCong("10"));

            await registry.connect(deployer).punishKeeper([users[0].address], parseEther("7"));

            expect(await registry.collaterals(users[0].address, cong.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(cong.address)).to.be.equal(parseEther("3"));
        });

        it("should punish cong keeper and record the rest as overissues", async function () {
            const collateralAmount = parseBtcInCong("10");
            await registry.connect(users[0]).addKeeper(cong.address, collateralAmount);

            const overissuedAmount = parseEther("12");
            await registry.connect(deployer).punishKeeper([users[0].address], overissuedAmount);

            const remainOverissuedAmount = overissuedAmount.sub(collateralAmount);
            expect(await registry.collaterals(users[0].address, cong.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(remainOverissuedAmount);
            expect(await registry.confiscations(cong.address)).to.be.equal(0);

            const congAmount = parseBtcInCong("1.5");
            const leftAmount = remainOverissuedAmount.sub(congAmount);
            await expect(registry.connect(users[3]).offsetOverissue(congAmount))
                .to.emit(registry, "OffsetOverissued")
                .withArgs(users[3].address, congAmount, leftAmount);
            expect(await registry.overissuedTotal()).to.be.equal(leftAmount);
        });

        it("should punish cong & non-cong keepers and confiscate the rest", async function () {
            await registry.connect(users[0]).addKeeper(cong.address, parseBtcInCong("10"));
            await registry.connect(users[1]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[2]).addKeeper(cong.address, parseBtcInCong("10"));

            await registry
                .connect(deployer)
                .punishKeeper(
                    [users[0].address, users[1].address, users[2].address],
                    parseEther("9")
                );

            expect(await registry.collaterals(users[0].address, cong.address)).to.be.equal(0);
            expect(await registry.collaterals(users[1].address, cong.address)).to.be.equal(0);
            expect(await registry.collaterals(users[2].address, wbtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(cong.address)).to.be.equal(parseEther("11"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
        });

        it("should punish cong & non-cong keepers and record the rest as overissues", async function () {
            await registry.connect(users[0]).addKeeper(cong.address, parseBtcInCong("10"));
            await registry.connect(users[1]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[2]).addKeeper(cong.address, parseBtcInCong("10"));

            await registry
                .connect(deployer)
                .punishKeeper(
                    [users[0].address, users[1].address, users[2].address],
                    parseEther("21")
                );

            expect(await registry.collaterals(users[0].address, cong.address)).to.be.equal(0);
            expect(await registry.collaterals(users[1].address, cong.address)).to.be.equal(0);
            expect(await registry.collaterals(users[2].address, wbtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("1"));
            expect(await registry.confiscations(cong.address)).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
        });
    });
});
