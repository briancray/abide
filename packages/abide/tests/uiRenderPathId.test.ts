import { describe, expect, test } from 'bun:test'
import { createScope } from '../src/lib/ui/createScope.ts'
import { CURRENT_PATH } from '../src/lib/ui/runtime/CURRENT_PATH.ts'
import { withPath } from '../src/lib/ui/runtime/withPath.ts'
import { withPathFrom } from '../src/lib/ui/runtime/withPathFrom.ts'

/*
Stage 1 of the serialization-stable lexical id (ADR render-path identity). A rendered scope's
`id` is now the ambient render-path — route + tree position, composed by `withPath` at each
nesting site — instead of the old process-local `scope-${n}` counter that restarted every run.
That id is the default key for `persist` (across reloads) and `broadcast` (across peers), so its
stability is the whole point: two mounts of the same route/position must yield the SAME id.

These exercise the composition primitives directly (the same `withPath`/`withPathFrom` calls the
router, `mountChild`, and the control-flow blocks emit), so the proof needs no DOM or router.
*/
describe('render-path scope id — serialization-stable across reloads', () => {
    test('same route → same id (a "reload" is deterministic, not a fresh counter)', () => {
        const first = withPath('/board/[id]', () => createScope({}, undefined, false).id)
        // A fresh mount at the SAME route — the old counter gave a different `scope-N` here.
        const second = withPath('/board/[id]', () => createScope({}, undefined, false).id)
        expect(second).toBe(first)
        expect(first).not.toMatch(/^scope-/) // not the run-unique fallback
    })

    test('composes route → child ordinal → branch key top-down', () => {
        const ids: string[] = []
        // page root
        withPath('p', () => {
            ids.push(createScope({}, undefined, false).id) // 'p'
            // a <Child/> mount (mountChild pushes its source-order ordinal)
            withPath(0, () => {
                ids.push(createScope({}, undefined, false).id) // 'p/0'
                // an {#if} then-branch (mountSwappableRange re-establishes base + branch key)
                withPathFrom('p/0', 'then', () => {
                    ids.push(createScope({}, undefined, false).id) // 'p/0/then'
                })
            })
            // a sibling <Child/> gets a DISTINCT ordinal, so two same-type siblings differ
            withPath(1, () => {
                ids.push(createScope({}, undefined, false).id) // 'p/1'
            })
        })
        expect(ids).toEqual(['p', 'p/0', 'p/0/then', 'p/1'])
    })

    test('a {#each} row key is escaped so a slash-bearing key stays one segment', () => {
        // an each row keyed by a URL-shaped id, re-established from a captured base (a swap)
        const id = withPathFrom('list', '/users/42', () => createScope({}, undefined, false).id)
        // escapeKey turns `/` into `~1`, so the whole key is one path segment under `list`
        expect(id).toBe('list/~1users~142')
    })

    test('a detached scope (no ambient path) falls back to the run-unique counter', () => {
        expect(CURRENT_PATH.current).toBe('') // outside any render
        const a = createScope({}, undefined, false).id
        const b = createScope({}, undefined, false).id
        expect(a).toMatch(/^scope-\d+$/)
        expect(a).not.toBe(b) // still unique within the run for undo / the bus
    })

    test('withPath restores the previous path after the build (strict stack)', () => {
        expect(CURRENT_PATH.current).toBe('')
        withPath('a', () => {
            expect(CURRENT_PATH.current).toBe('a')
            withPath('b', () => expect(CURRENT_PATH.current).toBe('a/b'))
            expect(CURRENT_PATH.current).toBe('a') // inner restored
        })
        expect(CURRENT_PATH.current).toBe('') // outer restored
    })
})
