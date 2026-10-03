import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const CI = !!process.env.CI;
// Keyless default: the local mainnet index from `docker compose up -d db && pnpm worker`.
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://curvebook:curvebook@localhost:5433/curvebook";
// CI builds .next in an earlier step and starts it. Locally the suite builds into its own dir
// so a running `next dev` (which owns .next) is never clobbered.
const DIST = process.env.NEXT_DIST_DIR ?? (CI ? ".next" : ".next-e2e");
const RESTORE_NEXT_ENV =
  "const fs=require('fs'),f='next-env.d.ts';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('./'+process.env.NEXT_DIST_DIR+'/','./.next/'))";
const SKIP_BUILD = CI || !!process.env.E2E_SKIP_BUILD;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Bundled chromium by default (CI installs it); PW_CHANNEL=chrome uses the system Chrome instead.
    ...devices["Desktop Chrome"],
    channel: !CI && process.env.PW_CHANNEL ? process.env.PW_CHANNEL : undefined,
  },
  projects: [{ name: "chromium" }],
  webServer: {
    // Production build + start: the same bundle judges get, no dev-mode recompiles mid-test.
    // `next build` points next-env.d.ts at the alternate dist dir; the inline node step points it back at .next.
    command: SKIP_BUILD
      ? `next start -p ${PORT}`
      : `next build && node -e "${RESTORE_NEXT_ENV}" && next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !CI,
    timeout: 240_000,
    env: { DATABASE_URL, NEXT_DIST_DIR: DIST },
    stdout: "ignore",
    stderr: "pipe",
  },
});
