// The browser gate: one project per app, each with its own server.
//
// `bun test` is the gate for everything that can be asserted without a browser, and it is the larger
// half by far. This is for the claims it cannot reach at all:
//
//   · a case's `interact` face, which the headless runner skips because it needs a click
//   · a reference example RENDERING, as opposed to compiling and server-rendering
//   · a page that produces correct markup and throws in the console on the way
//
// Two projects because there are two apps and they are not the same kind of thing. `dogfood` is served
// by `abide dev`, which builds the client into memory — no artifact to produce first, and the pages are
// what is under test rather than the bundle. `perf` is served the way it is measured.
//
// `testMatch` is `*.e2e.ts` rather than the usual `*.spec.ts`, and that is not a preference: `bun test`
// claims `.spec.` as its own, so a spec named that way is collected by the wrong runner.

import { defineConfig } from '@playwright/test'

/** Fixed ports, so a failing run leaves a URL somebody can open rather than one that has gone. */
const DOGFOOD_PORT = 4331
const PERF_PORT = 4332
/** The same dogfood app again, served under a sub-path. See the `mounted` project below. */
const MOUNTED_PORT = 4333
const MOUNT_BASE = '/v2'

const app = (port: number, cwd: string, env?: Record<string, string>) => ({
    command: `bun ../abide/cli/index.ts dev --port ${port}`,
    cwd,
    ...(env === undefined ? {} : { env }),
    url: `http://localhost:${port}${env === undefined ? '' : MOUNT_BASE}/`,
    // Never reused: an app left running from a previous session is an app serving whatever the files
    // said then, which is the one thing a gate must not measure.
    reuseExistingServer: false,
    // The client is built into memory on boot, and the dogfood app compiles every page and every rung.
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
            name: 'dogfood',
            testDir: './packages/dogfood/e2e',
            // `mounted/` is the same app under a sub-path and has its own server below. Ignored here
            // rather than moved elsewhere: it is this app's spec, and a recursive `testDir` would
            // otherwise run it against the ROOT server, where every path in it is off by `/v2`.
            testIgnore: '**/mounted/**',
            use: { baseURL: `http://localhost:${DOGFOOD_PORT}/` },
        },
        {
            name: 'perf',
            testDir: './packages/perf/e2e',
            use: { baseURL: `http://localhost:${PERF_PORT}/` },
        },
        // The SAME app, one environment variable different. A third project rather than a case inside
        // the first, because a mount is a fact about the whole process — the document, the bundle
        // route and every endpoint move together, and there is no way to ask one server for both.
        {
            name: 'mounted',
            testDir: './packages/dogfood/e2e/mounted',
            use: { baseURL: `http://localhost:${MOUNTED_PORT}${MOUNT_BASE}/` },
        },
    ],
    webServer: [
        app(DOGFOOD_PORT, './packages/dogfood'),
        app(PERF_PORT, './packages/perf'),
        app(MOUNTED_PORT, './packages/dogfood', {
            ...process.env,
            APP_URL: `http://localhost:${MOUNTED_PORT}${MOUNT_BASE}`,
        } as Record<string, string>),
    ],
})
