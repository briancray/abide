// EVERY SLOT `#shared` LEAVES FOR A SERVER, filled from one place rather than as a side effect of
// whichever server module a process happened to import — a compiler or a test that reaches one of
// them for a function is not made a server by it. Called where a server is entered: `bootApp`,
// `abide run`, and `@abide/abide/server`, which an app imports to be one. Filling the same functions again
// changes nothing, so each entry calls it. Four are filled elsewhere: `SCOPING.provider` at
// `requestScope.ts`'s import (its comment says why), `RPC_SERVER.raw` per boot,
// `RPC_SERVER.following` by each app's followers, and `LISTENING.timeout` by the dev worker alone.

import { COOKIES } from '#shared/cookies.ts'
import { CSP } from '#shared/csp.ts'
import { HEALTH } from '#shared/health.ts'
import { APP_NAME, TRACE } from '#shared/log.ts'
import { MOUNT } from '#shared/mount.ts'
import { REQUEST_AGENT } from '#shared/native.ts'
import { PRINCIPAL } from '#shared/principal.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import { UNEXPECTED } from '#shared/UNEXPECTED.ts'

import { configuredMount, derivedAppName, positiveSetting } from './config.ts'
import { cspRung, nonce } from './csp.ts'
import { handOnError } from './hooks.ts'
import { recordInRender } from './PageRender.ts'
import { SERVER_PRINCIPAL } from './principal.ts'
import { reportHealth } from './reportHealth.ts'
import {
    handlerTook,
    request,
    requestAgent,
    requestCookies,
} from './requestScope.ts'
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
    // 38.141 — the user agent `native` reads its window off.
    REQUEST_AGENT.current = requestAgent
    // 16.11 — the request a handler's rung is handed.
    RPC_SERVER.request = request
    // 16.58 — the environment's `timeout`, for every call a handler that names none makes.
    RPC_SERVER.timeout = () => positiveSetting('ABIDE_RPC_TIMEOUT', undefined)
    RPC_SERVER.reached = recordInRender
    RPC_SERVER.handled = handlerTook
}
