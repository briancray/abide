// EVERY SLOT `#shared` LEAVES FOR A SERVER, filled from one place rather than as a side effect of
// whichever server module a process happened to import — a compiler or a test that reaches one of
// them for a function is not made a server by it. Called where a server is entered: `bootApp`,
// `abide run`, and `abide/server`, which an app imports to be one. Filling the same functions again
// changes nothing, so each entry calls it. Three are filled elsewhere: `SCOPING.provider` at
// `requestScope.ts`'s import (its comment says why), `RPC_SERVER.raw` per boot, and
// `LISTENING.timeout` by the dev worker alone.

import { COOKIES } from '#shared/cookies.ts'
import { CSP } from '#shared/csp.ts'
import { HEALTH } from '#shared/health.ts'
import { APP_NAME, TRACE } from '#shared/log.ts'
import { MOUNT } from '#shared/mount.ts'
import { PRINCIPAL } from '#shared/principal.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import { UNEXPECTED } from '#shared/UNEXPECTED.ts'
import { reachedInRender } from './answerRequest.ts'
import { environmentTimeout } from './answerRpc.ts'
import { broadcast, feedFromServed, swept } from './answerSocket.ts'
import { configuredMount, derivedAppName } from './config.ts'
import { cspRung, nonce } from './csp.ts'
import { handOnError } from './hooks.ts'
import { SERVER_PRINCIPAL } from './principal.ts'
import { reportHealth } from './reportHealth.ts'
import { handlerTook, request, requestCookies } from './requestScope.ts'
import { trace } from './trace.ts'

export function installServer(): void {
    COOKIES.current = requestCookies
    MOUNT.current = configuredMount
    // Every log line written inside a scope carries its trace id.
    TRACE.current = trace
    APP_NAME.derived = derivedAppName
    UNEXPECTED.report = handOnError
    HEALTH.report = reportHealth
    CSP.rung = cspRung
    CSP.nonce = nonce
    Object.assign(PRINCIPAL, SERVER_PRINCIPAL)
    // 16.11 — the request a handler's rung is handed.
    RPC_SERVER.request = request
    RPC_SERVER.timeout = environmentTimeout
    RPC_SERVER.reached = reachedInRender
    RPC_SERVER.broadcast = broadcast
    RPC_SERVER.swept = swept
    RPC_SERVER.served = feedFromServed
    RPC_SERVER.handled = handlerTook
}
