import type { HttpVerb } from '../server/rpc/types/HttpVerb.ts'
import { verbRegistry } from '../server/rpc/verbRegistry.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { commandNameForUrl } from '../shared/commandNameForUrl.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'
import type { CliManifest } from './types/CliManifest.ts'
import type { CliManifestEntry } from './types/CliManifestEntry.ts'

type AnyApi = Record<string, (args?: unknown) => Promise<unknown>>

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
truth). Both can be supplied to support a binary that talks remote by
default but falls back to in-process when APP_URL is unset.
*/
export function createClient<Api extends AnyApi = AnyApi>(opts?: {
    url?: string
    token?: string
    manifest?: CliManifest
}): Api {
    const url = opts?.url
    const token = opts?.token
    const manifest = opts?.manifest

    /*
    Look up method + url for a given name. Manifest wins (the binary's
    baked-in source of truth); registry is the in-process fallback for
    use in same-project code where defineVerb has run.
    */
    function resolve(name: string): { method: HttpVerb; url: string } | undefined {
        const entry = manifest?.[name]
        if (entry) {
            return { method: entry.method, url: entry.url }
        }
        for (const value of verbRegistry.values()) {
            if (commandNameForUrl(value.remote.url) === name) {
                return { method: value.remote.method, url: value.remote.url }
            }
        }
        return undefined
    }

    async function callRemote(
        method: HttpVerb,
        path: string,
        args: unknown,
        baseUrl: string,
    ): Promise<unknown> {
        const headers = new Headers()
        if (token) {
            headers.set('authorization', `Bearer ${token}`)
        }
        const request = buildRpcRequest({ method, url: path, args, baseUrl, headers })
        const response = await fetch(request)
        if (!response.ok) {
            throw new Error(`${method} ${path} failed: ${response.status} ${response.statusText}`)
        }
        return decodeResponse(response)
    }

    async function callInProcess(method: HttpVerb, path: string, args: unknown): Promise<unknown> {
        const entry = verbRegistry.get(path)
        if (!entry) {
            throw new Error(
                `RPC ${path} not loaded — import the module first or set APP_URL to use remote mode`,
            )
        }
        const headers = new Headers()
        if (token) {
            headers.set('authorization', `Bearer ${token}`)
        }
        const request = buildRpcRequest({
            method,
            url: path,
            args,
            baseUrl: 'http://localhost/',
            headers,
        })
        const response = await entry.remote.fetch(request)
        if (!response.ok) {
            throw new Error(`${method} ${path} failed: ${response.status} ${response.statusText}`)
        }
        return decodeResponse(response)
    }

    return new Proxy({} as Api, {
        get(_target, prop): ((args?: unknown) => Promise<unknown>) | undefined {
            if (typeof prop !== 'string') {
                return undefined
            }
            const resolved = resolve(prop)
            if (!resolved) {
                return undefined
            }
            return (args?: unknown) =>
                url
                    ? callRemote(resolved.method, resolved.url, args, url)
                    : callInProcess(resolved.method, resolved.url, args)
        },
    })
}
