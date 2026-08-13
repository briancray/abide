// The browser gate: one project per app, each with its own server.
//
// `bun test` is the gate for everything that can be asserted without a browser, and it is the larger
// half by far. This is for the claims it cannot reach at all:
//
//   · a case's `interact` face, which the headless runner skips because it needs a click
//   · a reference example RENDERING, as opposed to compiling and server-rendering
//   · a page that produces correct markup and throws in the console on the way
//
// Two projects because there are two apps and they are not the same kind of thing. The example is served
// by `abide dev`, which builds the client into memory — no artifact to produce first, and the pages are
// what is under test rather than the bundle. `perf` is served the way it is measured.
//
// `testMatch` is `*.e2e.ts` rather than the usual `*.spec.ts`, and that is not a preference: `bun test`
// claims `.spec.` as its own, so a spec named that way is collected by the wrong runner.

import { defineConfig } from '@playwright/test'

/** Fixed ports, so a failing run leaves a URL somebody can open rather than one that has gone. */
const EXAMPLE_PORT = 4331
const PERF_PORT = 4332

const app = (port: number, cwd: string) => ({
    command: `bun ../abide/cli/index.ts dev --port ${port}`,
    cwd,
    url: `http://localhost:${port}/`,
    // Never reused: an app left running from a previous session is an app serving whatever the files
    // said then, which is the one thing a gate must not measure.
    reuseExistingServer: false,
    // The client is built into memory on boot, and the example compiles every page and every rung.
    timeout: 120_000,
})

export default defineConfig({
    testDir: '.',
    testMatch: '**/*.e2e.ts',
    // A browser is the slow substrate, so the specs are written to be parallel-safe: each navigates its
    // own page and none of them writes to the app.
    fullyParallel: true,
    // A flake here is a real answer about a real browser, so it is reported rather than retried away.
    retries: 0,
    reporter: process.env.CI === undefined ? [['list']] : [['github'], ['list']],
    use: {
        // Kept only for a failure, because that is the only time anybody looks.
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'example',
            testDir: './packages/example/e2e',
            use: { baseURL: `http://localhost:${EXAMPLE_PORT}/` },
        },
        {
            name: 'perf',
            testDir: './packages/perf/e2e',
            use: { baseURL: `http://localhost:${PERF_PORT}/` },
        },
    ],
    webServer: [app(EXAMPLE_PORT, './packages/example'), app(PERF_PORT, './packages/perf')],
})
