module.exports = {
    env: {
        es2021: true,
        node: true,
        mocha: true,
    },
    parserOptions: {
        ecmaVersion: 12,
        sourceType: "module",
    },
    plugins: ["@typescript-eslint"],
    parser: "@typescript-eslint/parser",
    extends: ["plugin:prettier/recommended"],
};
