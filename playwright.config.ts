import { defineConfig, devices } from '@playwright/test'

// Two projects over the ONE app: served at the root, and again under a sub-path.
// The sub-path arm is what catches a URL the framework built by assuming '/'.
const PORT = 3131
const BASE = `http://localhost:${PORT}`
const SUB_PATH = '/docs'

export default defineConfig({
    testDir: './packages/dogfood/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'blob' : 'list',
    use: { trace: 'on-first-retry' },
    projects: [
        {
            name: 'root',
            use: { ...devices['Desktop Chrome'], baseURL: BASE },
        },
        {
            name: 'sub-path',
            use: { ...devices['Desktop Chrome'], baseURL: BASE + SUB_PATH },
        },
    ],
    webServer: {
        command: 'bun run --filter dogfood start',
        url: BASE,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
    },
})
