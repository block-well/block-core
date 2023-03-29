module.exports = {
    norpc: true,
    testCommand: "yarn test",
    compileCommand: "yarn compile",
    providerOptions: {
        mnemonic:
            "tuition produce fat desk suggest case essence wreck warfare convince razor bless",
    },
    skipFiles: ["utils", "mock", "interfaces"],
    istanbulFolder: "./build/coverage",
};
