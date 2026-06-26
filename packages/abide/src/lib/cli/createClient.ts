import { dispatchVerbInProcess } from '../server/rpc/dispatchVerbInProcess.ts'
import { findVerbByCommandName } from '../server/rpc/findVerbByCommandName.ts'
import { buildRpcProxy } from '../shared/buildRpcProxy.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import type { HttpMethod } from '../shared/types/HttpMethod.ts'
import type { RpcInvoker } from '../shared/types/RpcInvoker.ts'
import type { CliManifest } from './types/CliManifest.ts'

/*
Each property of the client is a callable: invoking it decodes the body
(plain call), while `.raw(args)` returns the underlying Response without
decoding or throwing on non-2xx — the escape hatch the CLI uses to sniff
the Content-Type and stream sse/jsonl bodies frame-by-frame instead of
buffering through decodeResponse. buildRpcProxy owns that invoker contract.
*/
type AnyApi = Record<string, RpcInvoker>

/*
Builds a typed proxy over the project's RPCs for use in scripts, tests,
server-to-server calls, and the standalone CLI binary. Modes are
decided at construction:

  - With `url`: remote-mode. Each property access becomes an HTTP call
    against `<url>/<manifest[name].url>` using the manifest's method.
    Auth header is set from `token` when provided.
  - Without `url`: in-process mode. Each property access looks up the
    verb in the registry (populated by importing the project's rpc
    modules) and calls `verb.fetch(synthesizedRequest)` — same code
    path the HTTP router uses, no network hop.

The `manifest` is the bundler-emitted CLI manifest baked into the thin
binary. In in-process mode it's optional (registry is the source of
truth); in remote mode it supplies the method + url per command without
needing the rpc modules loaded. The mode is chosen solely by whether
`url` is set — the shipped CLI binary (see runCli) always passes `url`,
so it runs remote-only; in-process mode is for same-project scripts and
tests that import this directly without a `url`.
*/
export function createClient<Api extends AnyApi = AnyApi>(opts?: {
    url?: string
    token?: string
    manifest?: CliManifest
}): Api {
    const url = opts?.url
    const token = opts?.token
    const manifest = opts?.manifest

    // Auth + content-negotiation headers both dispatch modes attach.
    function requestHeaders(accept?: string): Headers {
        const headers = new Headers()
        if (token) {
            headers.set('authorization', `Bearer ${token}`)
        }
        if (accept) {
            headers.set('accept', accept)
        }
        return headers
    }

    /*
    Resolves a command name to the closure that issues its wire call, or
    undefined when the name is unknown in the active mode. Remote mode (url set)
    resolves method + url from the baked manifest — registry fallback for
    same-project callers — and sends the synthesized Request over the network.
    In-process mode resolves the verb from the registry and routes through
    dispatchVerbInProcess, the same synthesize-and-fetch the MCP dispatcher
    uses, so the two consumer surfaces can't drift on how a verb is invoked.
    */
    function resolveSend(name: string): ((args?: unknown) => Promise<Response>) | undefined {
        if (url) {
            const command = manifest?.[name] ?? registryCommand(name)
            if (!command) {
                return undefined
            }
            return (args) =>
                fetch(
                    buildRpcRequest({
                        method: command.method,
                        url: command.url,
                        args,
                        baseUrl: url,
                        headers: requestHeaders(command.accept),
                    }),
                )
        }
        const entry = findVerbByCommandName(name)
        if (!entry) {
            return undefined
        }
        return (args) =>
            dispatchVerbInProcess({
                remote: entry.remote,
                args,
                baseUrl: 'http://localhost/',
                headers: requestHeaders(),
            })
    }

    // Remote-mode registry fallback for callers passing a url but no manifest.
    function registryCommand(
        name: string,
    ): { method: HttpMethod; url: string; accept?: string } | undefined {
        const found = findVerbByCommandName(name)
        return found ? { method: found.remote.method, url: found.remote.url } : undefined
    }

    return buildRpcProxy<Api>(resolveSend)
}
