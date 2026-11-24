import type { Method } from './rpc.ts'

/**
 * A handler's name on MCP and OpenAPI: its method and its route, in the letters a tool's name admits.
 * Shared, so a page names a handler's tool as the server's surface does (44.51).
 *
 * 20.13 — the method first, so two handlers at one route are two names, and a segment's brackets
 * and dots dropped, so `/media/[id]` reads `media_id` rather than `media__id_`.
 */
export function surfaceName(method: Method, route: string): string {
    // 19.1 — a matcher is no part of what a route is, so none of its name: `=NAME` goes first.
    return `${method.toLowerCase()}${route === '/' ? '' : route.replace(/=[^\]]*/g, '').replace(/[[\].]/g, '')}`.replace(
        /[^a-zA-Z0-9-]/g,
        '_',
    )
}
