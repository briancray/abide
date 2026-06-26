import { isReadOnlyMethod } from '../../shared/isReadOnlyMethod.ts'
import type { HttpMethod } from '../../shared/types/HttpMethod.ts'
import { crossOriginForbidden } from './crossOriginForbidden.ts'
import { isCrossOriginRequest } from './isCrossOriginRequest.ts'

/*
The framework's CSRF/CSWSH posture in one place: a cross-origin browser
request to a mutating framework endpoint is refused. Every endpoint that
parses bodies ignoring Content-Type (rpc verbs, socket publish, MCP JSON-RPC)
must gate here — a hostile page's text/plain form trick could otherwise
smuggle a payload in with the visitor's ambient cookies; non-browser clients
send no Origin and pass. Returns the 403 to send, or undefined to proceed.
Mount sites declare their variation: `allowReadOnly` lets GET/HEAD reads
through (rpc reads and socket tails stay open cross-origin), `optOut` honours
a verb's explicit `crossOrigin: true`, `hint` names the remedy in the 403.
*/
export function crossOriginGate(
    req: Request,
    url: URL,
    options: { allowReadOnly?: boolean; optOut?: boolean; hint?: string } = {},
): Response | undefined {
    if (options.optOut) {
        return undefined
    }
    if (options.allowReadOnly && isReadOnlyMethod(req.method as HttpMethod)) {
        return undefined
    }
    return isCrossOriginRequest(req, url) ? crossOriginForbidden(options.hint) : undefined
}
