import type { Server } from 'bun'
import type { McpServer } from '../../src/lib/mcp/types/McpServer.ts'
import type { AppModule } from '../../src/lib/server/AppModule.ts'
import type { RemoteRoutes } from '../../src/lib/server/rpc/types/RemoteRoutes.ts'
import { createServer } from '../../src/lib/server/runtime/createServer.ts'
import { requestContext } from '../../src/lib/server/runtime/requestContext.ts'
import { resolvePageSnapshot } from '../../src/lib/server/runtime/resolvePageSnapshot.ts'
import { serverSlot } from '../../src/lib/server/runtime/serverSlot.ts'
import type { SocketRoutes } from '../../src/lib/server/sockets/types/SocketRoutes.ts'
import { baseSlot } from '../../src/lib/shared/baseSlot.ts'
import { cacheStoreSlot } from '../../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../../src/lib/shared/createCacheStore.ts'
import { globalCacheStoreSlot } from '../../src/lib/shared/globalCacheStoreSlot.ts'
import { pageSlot } from '../../src/lib/shared/pageSlot.ts'
import type { Pages } from '../../src/lib/ui/types/Pages.ts'

/* Minimal shell carrying the three SSR markers createServer splices into. */
const TEST_SHELL =
    '<!DOCTYPE html><html><head><!--ssr:head--></head><body><div id="app"><!--ssr:body--></div><!--ssr:state--></body></html>'

/*
Boots the real createServer on an ephemeral port with the same slot wiring
serverEntry performs at boot: the ALS-backed cache store resolver, the
request-scoped page resolver, and a process-level global cache store. Assets
ride the embedded (empty) maps so no dist/ or public/ scan happens. Returns
the origin for fetch() assertions and a stop() that releases the port and
restores every touched slot, so a suite boots and tears down without leaking
wiring into other test files in the same process.
*/
export async function bootTestServer(manifests: {
    pages?: Pages
    rpc?: RemoteRoutes
    sockets?: SocketRoutes
    app?: AppModule
    mcp?: McpServer
    shell?: string
    /* Mounts the dev-only surface (live-reload SSE, hot-module endpoint). */
    dev?: boolean
}): Promise<{ origin: string; server: Server<unknown>; stop: () => void }> {
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

    /* The same resolver serverEntry registers: the page proxy reads the live match off the ALS store. */
    pageSlot.resolver = resolvePageSnapshot

    const server = await createServer({
        pages: manifests.pages ?? {},
        rpc: manifests.rpc ?? {},
        sockets: manifests.sockets ?? {},
        prompts: {},
        shell: manifests.shell ?? TEST_SHELL,
        app: manifests.app,
        mcp: manifests.mcp,
        assets: {},
        publicAssets: {},
        mcpResources: {},
        port: 0,
        dev: manifests.dev,
    })

    function stop(): void {
        server.stop(true)
        cacheStoreSlot.resolver = previous.cacheResolver
        globalCacheStoreSlot.resolver = previous.globalResolver
        pageSlot.resolver = previous.pageResolver
        baseSlot.resolver = previous.baseResolver
        serverSlot.active = previous.activeServer
    }

    return { origin: `http://localhost:${server.port}`, server, stop }
}
