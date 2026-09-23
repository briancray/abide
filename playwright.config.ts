import { defineConfig, devices } from '@playwright/test'

// FOUR PROJECTS, TWO QUESTIONS. The dogfood app is served at the root and again under
// a sub-path — the sub-path arm is what catches a URL the framework built by assuming
// '/'. The harness pair is the measure lane's both-substrates gate, which needs a
// browser and no app, and runs in each of the two engines a reader actually brings.
//
// ONE CONFIG, BECAUSE `webServer` IS A WHOLE-RUN OPTION rather than a per-project one: the
// harness pair serves nothing and the app pair serves everything, so the two are told apart
// by project name rather than by a config each.
const PORT = 3131
// EXPORTED, because a spec that needs the APP rather than a blank page needs its address, and a
// second copy of the port in a spec file is the one way the two can disagree. `panel.spec.ts` is
// the reader: the measure panel is a docs artifact, so the docs have to be served for it to
// exist at all.
export const BASE = `http://localhost:${PORT}`
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
            testDir: './packages/dogfood/e2e',
            use: { ...devices['Desktop Chrome'], baseURL: BASE },
        },
        {
            name: 'sub-path',
            testDir: './packages/dogfood/e2e',
            use: { ...devices['Desktop Chrome'], baseURL: BASE + SUB_PATH },
        },
        // TWO ENGINES, because the measure lane runs in whatever browser a READER
        // brought. V8 and JSC are the two that reach a card in practice, and the whole
        // claim of this lane is that one case counts the same in each.
        {
            name: 'harness',
            testDir: './packages/harness/e2e',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'harness-webkit',
            testDir: './packages/harness/e2e',
            use: { ...devices['Desktop Safari'] },
        },
    ],
    webServer: {
        // BUILT, THEN STARTED. `abide start` boots what `abide build` produced (38.6), so a gate
        // that only starts is a gate against whatever was last built — a page edited and not
        // rebuilt passes or fails on the previous markup, which cost a debugging session.
        command:
            'bun run --filter dogfood build && bun run --filter dogfood start',
        url: BASE,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
    },
})
