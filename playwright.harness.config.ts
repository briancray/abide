// TEMPORARY, AND IT SAYS SO. The root config is the browser gate, and the harness's
// six specs are a project in it — but playwright starts the global `webServer` for
// EVERY project, that server is `abide start`, and `abide start` throws "not
// implemented". So a project that serves nothing cannot run through the root config
// until the one that serves everything can.
//
// This config is the same project with no server. DELETE IT when `abide start`
// lands: `bun run e2e` covers all three projects at that point and a second config
// is two places to change a browser option.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './packages/harness/e2e',
    reporter: 'list',
    // TWO ENGINES, because the measure lane now runs in whatever browser a READER
    // brought. V8 and JSC are the two that reach a card in practice, and the whole
    // claim of this lane is that one case counts the same in each.
    projects: [
        { name: 'harness', use: { ...devices['Desktop Chrome'] } },
        { name: 'harness-webkit', use: { ...devices['Desktop Safari'] } },
    ],
})
