import { defineConfig, devices } from '@playwright/test'

const PORT = 4321
const BASE_URL = `http://localhost:${PORT}`

// Two projects, because the suite holds two kinds of test with opposite scheduling needs.
//
// `chromium` is every FUNCTIONAL spec. Nothing in it reads a clock, so it runs fully parallel across
// workers — that is the fast loop you run while iterating.
//
// `perf` is the three in-browser bench specs. They measure, so they need the machine to themselves: run
// them under contention and they either report a number describing the contention or miss a budget
// outright. They are also, by a wide margin, the expensive half — measured over one full run they were
// 129s of the suite's 234s CPU. Keeping them in the default run forced `--workers=1` on EVERY spec to
// protect three of them, which is what made the whole suite take 2m12s.
//
// Playwright's `workers` is global rather than per-project, so the serialization lives in the package
// script (`e2e:perf` passes `--workers=1`) instead of here.
const BENCH_SPECS = /bench.*\.spec\.ts$/

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            testIgnore: BENCH_SPECS,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'perf',
            testMatch: BENCH_SPECS,
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'bun run scripts/serve-e2e.ts',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: { PORT: String(PORT) },
    },
})
