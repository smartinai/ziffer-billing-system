export default [
  {
    ignores: ["dist/**", "node_modules/**", "qa-screenshots/**", "playwright-report/**", "test-results/**"]
  },
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
        crypto: "readonly",
        document: "readonly",
        fetch: "readonly",
        navigator: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-control-regex": "error",
      "no-dupe-else-if": "error",
      "no-duplicate-case": "error",
      "no-fallthrough": "error",
      "no-irregular-whitespace": "error",
      "no-redeclare": "error",
      "no-self-assign": "error",
      "no-unreachable": "error",
      "no-unused-private-class-members": "error",
      "no-useless-catch": "error",
      "no-useless-escape": "error",
      "valid-typeof": "error"
    }
  }
];
