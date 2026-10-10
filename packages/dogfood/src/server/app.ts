// The docs app's own route and hooks, which every app.ts example reads.

import {
    csp,
    middleware,
    onConfig,
    onError,
    onHealth,
    onPrincipal,
    onStart,
    onStop,
} from '@abide/abide/server'
import { errorReportTracker } from '#server/errorReportTracker'
import { principalResolveDatabase } from '#server/principalResolveDatabase'
import { startHookDatabase } from '#server/startHookDatabase'

declare module '@abide/abide/server' {
    interface Config {
        INVOICE_PREFIX: string
        RETRIES: number
    }
}

declare module '@abide/abide' {
    interface Health {
        database: string
    }
    // What `onPrincipal` below resolves to; absent when nobody is signed in.
    interface Principal {
        id?: string
        name?: string
        role?: string
    }
}

// A sign-in lasts until a restart, unless the deployment sets its own secret.
const PRINCIPAL_SECRET = crypto.randomUUID()

onConfig(() => ({
    INVOICE_PREFIX: 'INV-',
    RETRIES: 3,
    ABIDE_PRINCIPAL_SECRET: PRINCIPAL_SECRET,
    // The assistant and Claude Code cards run live, over these two surfaces.
    ABIDE_MCP: true,
    ABIDE_BRIDGE: true,
}))

const INSTANCE = crypto.randomUUID().slice(0, 8)

// The docs frame their own invoice previews, so this origin may frame a page.
middleware(csp({ 'frame-ancestors': ["'self'"] }), async (next) => {
    const answer = await next()
    answer.headers.set('x-served-by', INSTANCE)
    return answer
})

onStart(async (start) => {
    await startHookDatabase.connect()
    await start()
    startHookDatabase.upAt = new Date().toISOString()
})

onStop(async (stop) => {
    await stop()
    await startHookDatabase.close()
})

onHealth(() => ({
    database: startHookDatabase.connected ? 'connected' : 'closed',
}))

onPrincipal(async (claims) => {
    const { id } = claims as { id: string }
    return principalResolveDatabase.users.find(id)
})

onError((error) => errorReportTracker.capture(error))

export default (request: Request) =>
    new URL(request.url).pathname === '/llms.txt'
        ? new Response('# abide\n\nEvery page, as markdown: abide.md\n')
        : undefined
