// commandTarget(input) — where a compiled binary's commands actually land, resolved LAZILY.
//
// A binary either targets a deployment (`--url` / `ABIDE_APP_URL`) or hosts the app itself. Hosting is
// deferred to the first call that needs it, which matters more than it looks: `myapp --help`, `myapp`
// followed by `exit`, and a mistyped command must not run the app's `onStart` (seed a database, open a
// connection) just to print text.
//
// When it does host, the call still goes over LOOPBACK HTTP rather than straight into the route
// callable. A direct in-process call would be faster and would answer a different question — over the
// wire, middleware, identity, the CSRF gate, schema validation, the memo and the run deadline all
// behave exactly as they do for a deployed request, so the CLI is a third client of the same face
// rather than a second implementation of it.
//
// `host()` is what the interactive `serve` command binds through: a REAL port (`--port` → `PORT` →
// 3000) instead of the ephemeral one a one-shot call uses. The `serve` SUBCOMMAND does not come here
// at all — it goes straight to `serveCompiled`, since it has nothing to do afterwards.

import type { ClientBuild } from '../internal/clientBundle.ts'
import { DEFAULT_PORT, hostApp, readEnvPort, type ServeResult } from '../internal/hostApp.ts'
import type { LoadedApp } from '../internal/loadApp.ts'
import type { CompiledApp } from './compiledAppConfig.ts'
import { embeddedClientBuild } from './embeddedClientBuild.ts'

export interface CommandTarget {
    // The origin to call. Boots the embedded server on FIRST use; a remote target never boots.
    origin(): Promise<string>
    // Bind the embedded app on a real, known port and return its URL. Throws when this binary is
    // pointed at a deployment — there is nothing local to host, and silently hosting a second copy
    // would be the wrong answer to "serve".
    host(port?: number): Promise<string>
    // Whether anything is bound right now (so the REPL can report it without booting).
    hosting(): string | undefined
    // The deployment this points at, if any — what a credential would be stored FOR. Undefined when
    // the binary hosts the app itself, which is why `login` refuses: there is no issuer to log in to.
    remote(): string | undefined
    // Point subsequent calls somewhere else — `connect`/`disconnect` from the prompt. A server already
    // bound by `serve` is deliberately LEFT RUNNING: the user asked for it, and stopping it because
    // they aimed their next command elsewhere would be a surprise. An ephemeral one costs nothing and
    // is stopped at exit.
    retarget(remote: string | undefined): void
    stop(): Promise<void>
}

export function commandTarget(input: {
    app: CompiledApp
    config: LoadedApp
    remote?: string | undefined
}): CommandTarget {
    let remote = input.remote
    let running: ServeResult | undefined
    // Decoding the embedded chunks is not free, and a rebind should not pay for it twice.
    let client: ClientBuild | undefined

    const boot = async (port?: number): Promise<string> => {
        if (client === undefined) client = await embeddedClientBuild(input.app)
        // `port: undefined` resolves `PORT` → 3000, exactly as `abide start` does; `0` asks the OS for
        // an ephemeral one, which is what a one-shot command wants (and must NOT be replaced by the
        // ladder, hence the explicit undefined check rather than `??`).
        running = await hostApp(input.config, {
            dev: false,
            port: port ?? readEnvPort() ?? DEFAULT_PORT,
            clientBuild: client,
        })
        return running.url
    }

    return {
        async origin(): Promise<string> {
            if (remote !== undefined) return remote
            if (running !== undefined) return running.url
            return await boot(0)
        },
        async host(port?: number): Promise<string> {
            if (remote !== undefined) {
                throw new Error(
                    `this binary is pointed at ${remote} — \`disconnect\` (or drop --url / ABIDE_APP_URL) to host the app here`,
                )
            }
            // A port is fixed at bind, so promoting the ephemeral server to a known port means a real
            // rebind — and the app's onStop/onStart run again. That is the honest cost of deciding to
            // serve after the fact, and it is why nothing binds until something asks.
            if (running !== undefined) {
                await running.stop()
                running = undefined
            }
            return await boot(port)
        },
        hosting(): string | undefined {
            return running?.url
        },
        remote(): string | undefined {
            return remote
        },
        retarget(next: string | undefined): void {
            remote = next
        },
        async stop(): Promise<void> {
            if (running === undefined) return
            const stopping = running
            running = undefined
            await stopping.stop()
        },
    }
}
