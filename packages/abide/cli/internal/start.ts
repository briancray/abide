// `abide start` — the app, served against what `abide build` wrote.
//
// The four layers are `layers.ts`'s, and this is the two decisions that make them PRODUCTION: the
// bundle is read off a disk rather than built, and `--port` binds and fails rather than hopping.
// `development` is off with them, so a stack trace is a log line rather than a response body.
//
// `abide dev` is the other half — the same assembly with a bundler and a watcher behind the first
// layer, and a hop instead of a refusal.

import { config } from '$server/config.ts'
import { boot } from '$server/lifecycle.ts'
import { pageFiles } from '$server/pages.ts'
import { websocket } from '$server/registry.ts'
import { messageOf } from '$shared/internal/probes.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { CLIENT_DIR, PAGES } from '../CLIENT_BUILD.ts'
import { clientAssets, type LoadedClient } from './assets.ts'
import { assemble, portFrom, report } from './layers.ts'

export async function start(argv: string[]): Promise<number> {
    const asked = portFrom(argv)
    if (typeof asked === 'string') {
        console.error(`abide start: ${asked}`)
        console.error('       usage: abide start [--port <n>]')
        return CLI_EXIT_CODES.usage
    }
    // Spelled as the VARIABLE, before anything resolves the document. `config()` is the one answer to
    // what this process is running on, so a flag that kept its own number beside it would be a second
    // one — and the app's own `PORT` default would go on being reported by `config().PORT` while the
    // socket sat somewhere else. Declared here, the flag beats an app's `onConfig` default exactly as
    // an operator's variable does, which is the same rule stated once.
    if (asked !== null) process.env.PORT = String(asked)

    const root = process.cwd()

    let built: LoadedClient | null
    try {
        built = await clientAssets(root)
    } catch (failure) {
        console.error(`abide start: ${CLIENT_DIR} is there and cannot be read — ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }
    // Asked of `pages/` rather than of a client entry, because the entry is generated from it: what
    // says a browser is owed a bundle is that there is something to render, not that somebody wrote
    // a file. An app with no pages is not this — it is an app made of endpoints, and it starts.
    if (built === null && (await pageFiles(`${root}/${PAGES}`).catch(() => [])).length > 0) {
        // Pages with no build is the one shape that is unambiguously a mistake: every `<script>` the
        // pages emit would 404. `abide dev` never reaches this, because building is what it does.
        console.error(`abide start: ${PAGES}/ is here and ${CLIENT_DIR} is not — run \`abide build\``)
        return CLI_EXIT_CODES.failed
    }

    // `config()`, not the flag: an app that declared its own default gets it, and the floor is 3000.
    // Taken as it is, because the document already resolved it as a PORT — however it was named, by a
    // variable or by an app's `onConfig` default. A floor here would be a third rule for one number.
    //
    // Read BEFORE the app is assembled, and not only for the port: resolving the document installs the
    // mount from `APP_URL`, and the shell `assemble` cuts writes that into every asset href.
    const port = config().PORT

    const assembled = await assemble({ root, label: 'abide start', client: built })
    if (typeof assembled === 'number') return assembled

    let running: Awaited<ReturnType<typeof boot<ReturnType<typeof Bun.serve>>>>
    try {
        running = await boot(() =>
            Bun.serve({
                port,
                // Off, deliberately. Bun's development mode answers an uncaught throw with a page
                // describing the stack, which is a debugging tool and an information leak in the same
                // response. `onError` is where an app decides what a failure looks like here.
                development: false,
                // Spelled, because Bun infers it from `development` and infers the wrong one here:
                // `development: false` turns SO_REUSEPORT ON, so a second production process binds
                // the same port instead of failing, both listen, and the kernel hands the requests
                // to whichever bound first. That is precisely the case `refused` below exists to
                // make loud — a deploy answering from the process it was meant to replace — and it
                // is silent, because both processes print `listening` on the port they agree on.
                reusePort: false,
                fetch: assembled.answer,
                websocket,
            }),
        )
    } catch (failure) {
        return refused(failure, port)
    }
    // `boot` says so on `abide:lifecycle` — an `onStart` that returned without calling `start()` is
    // the app deciding this process should not serve, so it is an outcome rather than a failure.
    if (running === null) return CLI_EXIT_CODES.ok

    report(running.url.href, assembled)

    // A server command has no number to answer with. The process ends when it is SIGNALLED, and the
    // handler that ends it is `boot`'s — so returning an exit code here would have `cli` hand one to
    // `process.exit` while the socket is still listening.
    return new Promise<number>(() => {})
}

/**
 * A bind that did not happen.
 *
 * A port in use is the one failure with something to say beyond the message, and it is HARD here on
 * purpose: `abide dev` hops to the next free port because a developer wants the thing to come up, and
 * a deploy that quietly listened somewhere else is a health check passing against the process it was
 * meant to replace. The `--port` this was given is the port or it is nothing.
 */
function refused(failure: unknown, port: number): number {
    if ((failure as { code?: string }).code === 'EADDRINUSE') {
        console.error(`abide start: port ${port} is already in use`)
        console.error('       stop what is on it, or name another with `--port <n>`')
    } else {
        console.error(`abide start: ${messageOf(failure)}`)
    }
    return CLI_EXIT_CODES.failed
}
