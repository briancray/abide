// THE SERVER-DISPATCH PRIMITIVE BENCH RECIPES — the single source of truth for both the CLI runner
// (`server.ts`) and the docs-app live server bench (`packages/docs/src/server/rpc/benchServer.ts`,
// streamed to `/platform/bench/server`). These are the tight, in-process per-request/per-read primitives
// on the hot path: route classification (`matchRoute`), cache-key building (`canonicalKey`), and the
// `cell` read/verb surface. All import abide via its public exports, so they run identically in the CLI
// and inside a docs page render — no server socket, no loopback (the end-to-end `createTestApp` dispatch
// benches stay CLI-only in `server.ts`; booting a real server is wrong for a live page).

import { matchRoute } from 'abide/server/internal/matchRoute'
import { cell } from 'abide/shared/cell'
import { canonicalKey } from 'abide/shared/internal/codec'

export interface ServerBench {
    group: string
    name: string
    note: string
    run: () => Promise<void> | void
}

// A representative page-route table (literal / required / optional / rest / multi-dynamic) — the shape
// `matchRoute` scans on every nav. The probe path matches a late multi-dynamic pattern so the scan
// exercises most of the table (worst-ish real case), the same work the router does per request.
export const BENCH_ROUTES: string[] = [
    '/',
    '/about',
    '/pricing',
    '/blog',
    '/blog/[slug]',
    '/docs',
    '/docs/[...path]',
    '/login',
    '/logout',
    '/dashboard',
    '/dashboard/[[tab]]',
    '/search',
    '/settings',
    '/settings/profile',
    '/settings/billing',
    '/products',
    '/products/[category]',
    '/products/[category]/[id]',
    '/orgs/[org]/repos/[repo]',
    '/users/[id]',
    '/users/[id]/settings',
    '/users/[id]/posts/[postId]',
    '/legal/[...rest]',
]

// Build the primitive recipes, doing any one-time setup (priming the warm cell, populating the slots the
// verb scan walks). Async because the cell primes are awaited.
export async function createServerBenches(): Promise<ServerBench[]> {
    // Warm cell: the dominant in-process RPC read path — ensureSlot → canonicalKey → touchOnRead →
    // signal → coalescedLoad over a retained slot. Prime once so the timed read is a cache hit.
    const warm = cell<{ id: number }, number>((a) => a.id * 2)
    await warm({ id: 1 })

    // Verb-scan cell: `invalidate` with an object selector runs `selectSlots` (full context-cache scan)
    // × `matchesSelector`. Populate 100 slots, then time a NO-MATCH selector so the full 100-slot scan
    // runs every op without mutating the slot set.
    const many = cell<{ n: number; group: number }, number>((a) => a.n)
    for (let n = 0; n < 100; n++) await many({ n, group: n % 5 })

    return [
        {
            group: 'route',
            name: 'matchRoute',
            note: `${BENCH_ROUTES.length} patterns → deep dynamic path`,
            run: () => {
                matchRoute(BENCH_ROUTES, '/users/42/posts/99')
            },
        },
        {
            group: 'cache-key',
            name: 'canonicalKey/scalar',
            note: 'canonicalKey(number)',
            run: () => {
                canonicalKey(42)
            },
        },
        {
            group: 'cache-key',
            name: 'canonicalKey/object',
            note: '4-field object',
            run: () => {
                canonicalKey({ id: 7, page: 2, sort: 'desc', filter: 'active' })
            },
        },
        {
            group: 'cell',
            name: 'read-warm',
            note: 'cache-hit read (same args)',
            run: async () => {
                await warm({ id: 1 })
            },
        },
        {
            group: 'cell',
            name: 'invalidate-scan-100',
            note: 'full 100-slot selector scan (no match)',
            run: () => {
                many.invalidate({ group: 999 })
            },
        },
    ]
}
