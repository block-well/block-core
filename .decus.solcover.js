module.exports = {
    norpc: true,
    testCommand: "npm test",
    compileCommand: "npm run compile",
    providerOptions: {
        mnemonic:
            "tuition produce fat desk suggest case essence wreck warfare convince razor bless",
    },
    skipFiles: ["utils", "mock", "interfaces", "EBTC.sol"],
    istanbulFolder: "./build/coverage",
};
