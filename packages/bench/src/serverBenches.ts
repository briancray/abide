// THE SERVER-DISPATCH PRIMITIVE BENCH RECIPES — the single source of truth for both the CLI runner
// (`server.ts`) and the docs-app live server bench (`packages/docs/src/server/rpc/benchServer.ts`,
// streamed to `/platform/bench/server`). These are the tight, in-process per-request/per-read primitives
// on the hot path: route classification (`matchRoute`), cache-key building (`canonicalKey`), and the
// `memo` read/verb surface. All import abide via its public exports, so they run identically in the CLI
// and inside a docs page render — no server socket, no loopback (the end-to-end `createTestApp` dispatch
// benches stay CLI-only in `server.ts`; booting a real server is wrong for a live page).

import { matchRoute } from 'abide/server/internal/matchRoute'
import { canonicalKey } from 'abide/shared/internal/codec'
import { memo } from 'abide/shared/memo'

export interface ServerBench {
    group: string
    name: string
    note: string
    run: () => Promise<void> | void
    // The SAME work hand-written with no framework, timed by the same loop so the recipe can be reported
    // as a multiple of it (× = abide ÷ vanilla). Same honesty rules as the frontend corpus
    // (`vanillaBaselines.ts`): same work, idiomatic hand-written code, no strawman in either direction.
    // Absent where no framework-free equivalent is meaningful — or where the recipe is ALREADY vanilla
    // (`codec/jsonl-encode` is a bare `JSON.stringify` loop; it is its own baseline).
    baseline?: {
        note: string
        run: () => Promise<void> | void
    }
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

const BENCH_PATH = '/users/42/posts/99'

interface HandRolledRoute {
    pattern: RegExp
    keys: string[]
}

// The framework-free way to match the same table: precompile each pattern to a RegExp once, then scan in
// order with `exec` and zip the captures into a params object. No route ranking, no precedence rules —
// which is exactly the point of a baseline.
function compileHandRolledRoutes(patterns: string[]): HandRolledRoute[] {
    const routes: HandRolledRoute[] = []
    for (const pattern of patterns) {
        const keys: string[] = []
        let source = '^'
        for (const segment of pattern.split('/')) {
            if (segment === '') continue
            if (segment.startsWith('[...')) {
                keys.push(segment.slice(4, -1))
                source += '/(.*)'
            } else if (segment.startsWith('[[')) {
                keys.push(segment.slice(2, -2))
                source += '(?:/([^/]+))?'
            } else if (segment.startsWith('[')) {
                keys.push(segment.slice(1, -1))
                source += '/([^/]+)'
            } else {
                source += `/${segment}`
            }
        }
        routes.push({ pattern: new RegExp(`${source}$`), keys })
    }
    return routes
}

// Build the primitive recipes, doing any one-time setup (priming the warm memo, populating the slots the
// verb scan walks). Async because the memo primes are awaited.
export async function createServerBenches(): Promise<ServerBench[]> {
    // Warm memo: the dominant in-process RPC read path — ensureSlot → canonicalKey → touchOnRead →
    // state → coalescedLoad over a retained slot. Prime once so the timed read is a cache hit.
    const warm = memo<{ id: number }, number>((a) => a.id * 2)
    await warm({ id: 1 })

    // Verb-scan memo: `invalidate` with an object selector runs `selectSlots` (full context-cache scan)
    // × `matchesSelector`. Populate 100 slots, then time a NO-MATCH selector so the full 100-slot scan
    // runs every op without mutating the slot set.
    const many = memo<{ n: number; group: number }, number>((a) => a.n)
    for (let n = 0; n < 100; n++) await many({ n, group: n % 5 })

    // ── hand-written baselines ──────────────────────────────────────────────────────────────────────
    const handRolledRoutes = compileHandRolledRoutes(BENCH_ROUTES)

    // The memo a person writes by hand: stringify the args, hit a Map, compute on a miss.
    const handRolledCache = new Map<string, number>()
    const handRolledMemo = async (args: { id: number }): Promise<number> => {
        const key = JSON.stringify(args)
        const hit = handRolledCache.get(key)
        if (hit !== undefined) return hit
        const value = args.id * 2
        handRolledCache.set(key, value)
        return value
    }
    await handRolledMemo({ id: 1 })

    // The hand-written analog of the verb scan: 100 entries in a Map, walked and filtered by field.
    const handRolledSlots = new Map<string, { n: number; group: number }>()
    for (let n = 0; n < 100; n++) handRolledSlots.set(`${n}:${n % 5}`, { n, group: n % 5 })

    return [
        {
            group: 'route',
            name: 'matchRoute',
            note: `${BENCH_ROUTES.length} patterns → deep dynamic path`,
            run: () => {
                matchRoute(BENCH_ROUTES, BENCH_PATH)
            },
            baseline: {
                note: 'precompiled RegExp table, scanned in order',
                run: () => {
                    for (const route of handRolledRoutes) {
                        const match = route.pattern.exec(BENCH_PATH)
                        if (match === null) continue
                        const params: Record<string, string> = {}
                        for (let i = 0; i < route.keys.length; i++)
                            params[route.keys[i]!] = match[i + 1] ?? ''
                        break
                    }
                },
            },
        },
        {
            group: 'cache-key',
            name: 'canonicalKey/scalar',
            note: 'canonicalKey(number)',
            run: () => {
                canonicalKey(42)
            },
            baseline: {
                note: 'String(n)',
                run: () => {
                    String(42)
                },
            },
        },
        {
            group: 'cache-key',
            name: 'canonicalKey/object',
            note: '4-field object',
            run: () => {
                canonicalKey({ id: 7, page: 2, sort: 'desc', filter: 'active' })
            },
            baseline: {
                note: 'JSON.stringify (no key-order canonicalisation)',
                run: () => {
                    JSON.stringify({ id: 7, page: 2, sort: 'desc', filter: 'active' })
                },
            },
        },
        {
            group: 'memo',
            name: 'read-warm',
            note: 'cache-hit read (same args)',
            run: async () => {
                await warm({ id: 1 })
            },
            baseline: {
                note: 'JSON.stringify key → Map.get',
                run: async () => {
                    await handRolledMemo({ id: 1 })
                },
            },
        },
        {
            group: 'memo',
            name: 'invalidate-scan-100',
            note: 'full 100-slot selector scan (no match)',
            run: () => {
                many.invalidate({ group: 999 })
            },
            baseline: {
                note: '100-entry Map walk, delete on field match',
                run: () => {
                    for (const [key, slot] of handRolledSlots) {
                        if (slot.group === 999) handRolledSlots.delete(key)
                    }
                },
            },
        },
    ]
}
