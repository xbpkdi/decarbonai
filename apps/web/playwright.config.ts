import { defineConfig } from "@playwright/test";

// Smoke screenshots of every page. Runs against BASE_URL, or starts `next start` on :3123.
const baseURL = process.env.BASE_URL ?? "http://localhost:3123";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  reporter: "list",
  use: { baseURL, colorScheme: "dark" },
  webServer: process.env.BASE_URL ? undefined : { command: "next start -p 3123", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
