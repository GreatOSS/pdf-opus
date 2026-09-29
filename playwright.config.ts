import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:4174", trace: "retain-on-failure" },
  webServer: {
    command: "npx vite build && npx vite preview --port 4174 --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 800 } }, grepInvert: /@mobile/ },
  ],
});
