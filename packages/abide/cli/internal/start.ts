// `abide start` — the app, served against what `abide build` wrote.
//
// The four layers are `layers.ts`'s and so is the bind, and this is the two decisions that make them
// PRODUCTION: the bundle is read off a disk rather than built, and `--port` binds and fails rather
// than hopping. `development` is off with them, so a stack trace is a log line rather than a response
// body.
//
// `abide dev` is the other half — the same assembly with a bundler and a watcher behind the first
// layer, and a hop instead of a refusal.

import { config } from '#server/config.ts'
import { pageFiles } from '#server/pages.ts'
import { messageOf } from '#shared/internal/probes.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { CLIENT_DIR, PAGES } from '../CLIENT_BUILD.ts'
import { clientAssets, type LoadedClient } from './assets.ts'
import { assemble, bind, portAsked, report } from './layers.ts'

export async function start(argv: string[]): Promise<number> {
    if (!portAsked(argv, 'start')) return CLI_EXIT_CODES.usage

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

    const running = await bind(assembled, port, 'abide start')
    if (typeof running === 'number') return running
    // `boot` says so on `abide:lifecycle` — an `onStart` that returned without calling `start()` is
    // the app deciding this process should not serve, so it is an outcome rather than a failure.
    if (running === null) return CLI_EXIT_CODES.ok

    report(running.url.href, assembled)

    // A server command has no number to answer with. The process ends when it is SIGNALLED, and the
    // handler that ends it is `boot`'s — so returning an exit code here would have `cli` hand one to
    // `process.exit` while the socket is still listening.
    return new Promise<number>(() => {})
}
