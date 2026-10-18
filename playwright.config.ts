import { defineConfig, devices } from '@playwright/test'

// SIX PROJECTS, THREE QUESTIONS. The dogfood app is served at the root and again under
// a sub-path — the sub-path arm is what catches a URL the framework built by assuming
// '/'. The abide pair is the framework's own browser specs and benches, and the harness
// pair is the measure lane's both-substrates gate; both need a browser and no app, and
// run in each of the two engines a reader actually brings.
//
// ONE CONFIG, BECAUSE `webServer` IS A WHOLE-RUN OPTION rather than a per-project one: the
// browser pairs serve nothing and the app pair serves everything, so they are told apart
// by project name rather than by a config each.
const PORT = 3131
const BASE = `http://localhost:${PORT}`
// THE SUB-PATH ARM IS A SERVER OF ITS OWN. `APP_URL`'s path is the mount (36.2, 16.10), and one
// process has one — so the same build is served twice, the second below `/docs`.
const SUB_PORT = 3132
const SUB_BASE = `http://localhost:${SUB_PORT}/docs`

export default defineConfig({
    testDir: './packages/dogfood/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'blob' : 'list',
    use: { trace: 'on-first-retry' },
    projects: [
        // THE ABIDE PAIR IS LISTED FIRST because its specs are the run's longest, and playwright
        // hands out work in project order: started last, they were the tail every worker waited on.
        // TWO ENGINES, because the measure lane runs in whatever browser a READER
        // brought. V8 and JSC are the two that reach a card in practice, and the whole
        // claim of this lane is that one case counts the same in each.
        {
            name: 'abide',
            testDir: './packages/abide/e2e',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'abide-webkit',
            testDir: './packages/abide/e2e',
            use: { ...devices['Desktop Safari'] },
        },
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
        // A CHAPTER APP'S OWN BROWSER SPEC, under its `e2e`, which its bunfig's test root keeps `bun test`
        // out of. It drives
        // the app where the docs serve it (40.15), and its addresses are relative so the same spec
        // runs against the app served on its own. Chromium: the engine lane is CDP.
        {
            name: 'cards',
            testDir: './packages/dogfood/examples/crm-10/e2e',
            use: {
                ...devices['Desktop Chrome'],
                baseURL: `${BASE}/`,
            },
        },
        {
            name: 'root',
            testDir: './packages/dogfood/e2e',
            use: { ...devices['Desktop Chrome'], baseURL: BASE },
        },
        {
            name: 'sub-path',
            testDir: './packages/dogfood/e2e',
            use: { ...devices['Desktop Chrome'], baseURL: SUB_BASE },
        },
    ],
    webServer: [
        {
            // BUILT, THEN STARTED. `abide start` boots what `abide build` produced (38.6), so a
            // gate that only starts is a gate against whatever was last built — a page edited and
            // not rebuilt passes or fails on the previous markup, which cost a debugging session.
            command:
                'bun run --filter dogfood build && bun run --filter dogfood start',
            url: BASE,
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
        },
        {
            // THE SAME BUILD, STARTED ONLY: playwright starts its servers in order and waits on
            // each, so this boots what the one above has just built — and the build is the one
            // artifact both serve, which is 16.10's whole claim.
            command: `bun ../abide/bin/abide.ts start --port ${SUB_PORT}`,
            cwd: 'packages/dogfood',
            env: { APP_URL: SUB_BASE },
            url: `${SUB_BASE}/`,
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
        },
    ],
})
