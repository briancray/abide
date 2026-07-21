import { defineConfig, devices } from '@playwright/test'

// 4322 so the starter suite can run alongside docs (4321) without a port clash.
const PORT = 4322
const BASE_URL = `http://localhost:${PORT}`

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
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'bun run scripts/serve-e2e.ts',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: { PORT: String(PORT) },
    },
})
