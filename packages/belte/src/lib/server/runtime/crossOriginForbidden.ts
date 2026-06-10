import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'

/*
The framework's CSRF refusal, shared by every same-origin gate — the socket
upgrade, the socket REST publish face, the MCP endpoint, and mutating rpc
verbs — so the 403 body can't drift between surfaces. `hint` appends a
surface-specific remedy; rpc names its `crossOrigin: true` opt-out so the
first developer this 403s can self-serve.
*/
export function crossOriginForbidden(hint?: string): Response {
    const detail = hint ? ` ${hint}` : ''
    return new Response(
        `Forbidden: cross-origin browser request refused (CSRF protection).${detail}`,
        { status: 403, headers: { 'Cache-Control': NO_STORE } },
    )
}
