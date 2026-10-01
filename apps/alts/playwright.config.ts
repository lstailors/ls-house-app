import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke only the e2e specs. Default discovery also loads src/**\/*.test.ts,
 * which import bun:test and crash Node with "Received protocol 'bun:'".
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:8010",
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 8010",
    url: "http://127.0.0.1:8010",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
