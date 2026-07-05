import type { Server } from 'bun'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import * as appMod from '../../_virtual/app.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { appInfo } from '../../_virtual/app-info.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { assets } from '../../_virtual/assets.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import cliProgramName from '../../_virtual/cli-name.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { layouts } from '../../_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import mcp from '../../_virtual/mcp.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { mcpResources } from '../../_virtual/mcp-resources.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { pages } from '../../_virtual/pages.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { prompts } from '../../_virtual/prompts.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { publicAssets } from '../../_virtual/public-assets.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { rpc } from '../../_virtual/rpc.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { shell } from '../../_virtual/shell.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { sockets } from '../../_virtual/sockets.ts'
import { rpcRegistry } from '../server/rpc/rpcRegistry.ts'
import { createServer } from '../server/runtime/createServer.ts'
import { ensureRegistriesLoaded } from '../server/runtime/registryManifests.ts'
import { requestContext } from '../server/runtime/requestContext.ts'
import { resolvePageSnapshot } from '../server/runtime/resolvePageSnapshot.ts'
import { serverSlot } from '../server/runtime/serverSlot.ts'
import type { Socket } from '../server/sockets/types/Socket.ts'
import { baseSlot } from '../shared/baseSlot.ts'
import { buildRpcProxy } from '../shared/buildRpcProxy.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { cacheStoreSlot } from '../shared/cacheStoreSlot.ts'
import { commandNameForUrl } from '../shared/commandNameForUrl.ts'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { globalCacheStoreSlot } from '../shared/globalCacheStoreSlot.ts'
import { HEALTH_PATH } from '../shared/HEALTH_PATH.ts'
import { pageSlot } from '../shared/pageSlot.ts'
import { SOCKETS_PATH } from '../shared/SOCKETS_PATH.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import { createTestSocketChannel } from './createTestSocketChannel.ts'

/*
Augmentable rpc/socket maps for `app.rpc.<rpc>` / `app.sockets.<name>`. The
build's writeTestRpcDts / writeTestSocketsDts emit one entry per rpc/socket
(into src/.abide/), so the keys + signatures are the project's real surface
with no imports. Empty here; types arrive once the app has been built. Mirrors
url's RpcRoutes / health's AppHealthMap.
*/
// @documentation testing
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated testRpc.d.ts
export interface RpcClient {}
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated testSockets.d.ts
export interface SocketClient {}

/* The booted app under test. Every named subsystem is reachable as the rpc
   you call, the socket you iterate, or a path you fetch — over the real
   server, so the full pipeline (CSRF, cookies, base path) runs. */
export type TestApp = {
    /* The kernel-assigned origin, e.g. http://localhost:51234. */
    origin: string
    /* fetch against the app: prefixes the kernel-assigned origin, so you pass a
       route-space path (`/products/1`), not the wire URL. The booted server
       matches routes at raw paths — the APP_URL mount base is stripped by an
       external proxy in production, absent here — so paths carry no base. */
    fetch: (path: string, init?: RequestInit) => Promise<Response>
    /* Rpc calls over HTTP, keyed by command name: `app.rpc.getProduct({ id })`. */
    rpc: RpcClient
    /* Sockets keyed by name: `app.sockets.ticker` is the Socket — iterate it for
       the live stream, `.tail(n)` to seed, `.broadcast(m)` to send. */
    sockets: SocketClient
    /* The /__abide/health payload, decoded. */
    health: () => Promise<unknown>
    /* Stops the server, releases the port, restores every touched slot. */
    stop: () => Promise<void>
    /* `await using app = await createTestApp()` — disposal runs stop(), so a
       thrown assertion still releases the port and restores the slots rather
       than leaking the request-scope/cache/page resolvers into the next file. */
    [Symbol.asyncDispose]: () => Promise<void>
}

/*
Boots the real app on an ephemeral port — the same wiring serverEntry performs,
minus the standalone-binary env layers. Imports the framework's virtual
manifests (resolved by abideResolverPlugin, registered via `abide/preload`
in the consumer's bunfig), so the routes, rpcs, and sockets are the project's
real surface, not a fixture. Pass nothing: `await createTestApp()` is the app
exactly as `bun start` would serve it.

Slots are saved and restored around the boot so a suite tears down without
leaking the request-scope/cache/page resolvers into the next test file.
*/
export async function createTestApp(): Promise<TestApp> {
    const previous = {
        cacheResolver: cacheStoreSlot.resolver,
        globalResolver: globalCacheStoreSlot.resolver,
        pageResolver: pageSlot.resolver,
        baseResolver: baseSlot.resolver,
        activeServer: serverSlot.active,
    }

    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    const globalStore = createCacheStore()
    globalCacheStoreSlot.resolver = () => globalStore
    pageSlot.resolver = resolvePageSnapshot

    /* Eager env validation, exactly as serverEntry: a top-level env(schema) in
       src/server/config.ts fails the boot loudly here rather than lazily. No-op
       when the file is absent. */
    // @ts-expect-error virtual module resolved by abideResolverPlugin
    await import('../../_virtual/config.ts')

    const server: Server<unknown> = await createServer({
        pages,
        layouts,
        rpc,
        sockets,
        prompts,
        shell,
        app: appMod,
        assets,
        publicAssets,
        mcpResources,
        mcp,
        cliProgramName,
        appInfo,
        port: 0,
    })

    const origin = `http://localhost:${server.port}`

    function appFetch(path: string, init?: RequestInit): Promise<Response> {
        return fetch(`${origin}${path}`, init)
    }

    /* Rpc modules loaded once so the registry holds every RemoteFunction; the
       proxy maps command name → an HTTP call against the booted server. */
    await ensureRegistriesLoaded()
    const remotes = new Map<string, RemoteFunction<unknown, unknown>>(
        Array.from(rpcRegistry.values()).map((entry) => [
            commandNameForUrl(entry.remote.url),
            entry.remote,
        ]),
    )

    function send(remote: RemoteFunction<unknown, unknown>, args: unknown): Promise<Response> {
        /* Same-origin Origin header so the CSRF gate admits mutating rpcs; the
           server serves rpcs at their raw url (no mount base applied here). */
        const request = buildRpcRequest({
            method: remote.method,
            url: remote.url,
            args,
            baseUrl: `${origin}/`,
            headers: new Headers({ origin }),
        })
        return fetch(request)
    }

    const rpcClient = buildRpcProxy<RpcClient>((name) => {
        const remote = remotes.get(name)
        return remote ? (args) => send(remote, args) : undefined
    })

    /* One ws to the booted multiplex, dialed lazily on first socket access so a
       suite touching no socket holds no connection. http→ws, raw path. */
    const wsUrl = `${origin.replace(/^http/, 'ws')}${SOCKETS_PATH}`
    let channel: ReturnType<typeof createTestSocketChannel> | undefined
    const socketNames = new Set(Object.keys(sockets as Record<string, unknown>))
    const socketClient = new Proxy({} as Record<string, Socket<unknown>>, {
        get(_target, prop): Socket<unknown> | undefined {
            if (typeof prop !== 'string' || !socketNames.has(prop)) {
                return undefined
            }
            channel ??= createTestSocketChannel(wsUrl)
            return channel.socket(prop)
        },
    })

    async function stop(): Promise<void> {
        channel?.close()
        server.stop(true)
        cacheStoreSlot.resolver = previous.cacheResolver
        globalCacheStoreSlot.resolver = previous.globalResolver
        pageSlot.resolver = previous.pageResolver
        baseSlot.resolver = previous.baseResolver
        serverSlot.active = previous.activeServer
    }

    return {
        origin,
        fetch: appFetch,
        rpc: rpcClient,
        sockets: socketClient as unknown as SocketClient,
        health: () => appFetch(HEALTH_PATH).then((response) => response.json()),
        stop,
        [Symbol.asyncDispose]: stop,
    }
}
