const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:8080",
    headless: false,
    slowMo: 300,
  },
  timeout: 30000,
});
