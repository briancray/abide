import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { docSnapshotsSlot } from '../src/lib/shared/docSnapshotsSlot.ts'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import type { DocSnapshots } from '../src/lib/shared/types/DocSnapshots.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { DOC_SEED } from '../src/lib/ui/runtime/DOC_SEED.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { withPath } from '../src/lib/ui/runtime/withPath.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
Doc-state warm-seed (option A): a plain `state(initial)` re-runs its initializer on the client, so a
uuid/timestamp/random would diverge from the SSR HTML. The server captures each rendered scope's doc
snapshot keyed by its render-path id (`createScope` → `docSnapshotsSlot`), the renderer stamps it into
`__SSR__.docs`, and on hydration `createScope` seeds it: the FIRST `replace` to each slot (the eager
init) adopts the server value and drops the fresh one (consume-once). Same render-path keying as the
async-cell warm-seed, driven directly here under a shared `withPath` root so the keys agree.
*/
beforeAll(() => {
    installMiniDom()
})

let previous: typeof docSnapshotsSlot.resolver
beforeEach(() => {
    previous = docSnapshotsSlot.resolver
    const snapshots: DocSnapshots = { entries: [] }
    docSnapshotsSlot.resolver = () => snapshots
})
afterEach(() => {
    docSnapshotsSlot.resolver = previous
    for (const key of Object.keys(DOC_SEED)) {
        delete DOC_SEED[key]
    }
})

const ROUTE = '/products/[id]'
/* The scope id is the escaped render-path (route), matching how `createAsyncCell`'s keys are formed. */
const SCOPE_ID = '~1products~1[id]'
/* A plain `state(mkId())` — no transform, so it lowers to a doc slot. `mkId` is a free identifier,
   passed into the compiled body so the server and client can return different values. */
const SOURCE =
    `<script>import { state } from '@abide/abide/ui/state'\n` +
    `let id = state(mkId())</script>\n` +
    `<p>{id}</p>`

describe('doc-state warm-seed crosses SSR→client by render-path id', () => {
    test('SSR records the scope doc snapshot keyed by the render-path id', async () => {
        const ssrBody = compileSSR(SOURCE)
        const serverMkId = () => 'SERVER'
        const render = await withPath(ROUTE, () =>
            new Function('$props', '$ctx', 'mkId', ssrBody)(undefined, undefined, serverMkId),
        )
        expect((render as SsrRender).html).toBe('<p>SERVER</p>')

        const entries = docSnapshotsSlot.get()?.entries ?? []
        expect(entries).toHaveLength(1)
        expect(entries[0]!.id).toBe(SCOPE_ID)
        // The lazy snapshot materializes to the post-init doc state.
        expect(entries[0]!.take()).toEqual({ id: 'SERVER' })
    })

    test('the client adopts the seeded server value, not a fresh client init', () => {
        // Seed as the renderer would: ref-json-encode the SSR snapshot under its render-path key.
        DOC_SEED[SCOPE_ID] = encodeRefJson({ id: 'SERVER' })

        const clientBody = compileComponent(SOURCE)
        // The client's init returns a DIFFERENT value; if it leaked through, the text would be CLIENT.
        const clientMkId = () => 'CLIENT'
        const build = (host: Element, _props: unknown) =>
            new Function('host', 'mkId', clientBody)(host, clientMkId)
        const host = document.createElement('div')
        withPath(ROUTE, () => mount(host, build))

        // Adopted: the eager init `replace("id", "CLIENT")` was consumed, keeping the server value.
        expect(host.textContent).toBe('SERVER')
    })

    test('a missing seed falls back to the fresh client init — no crash', () => {
        // No DOC_SEED entry → the scope has nothing to consume, so the init value stands.
        const clientBody = compileComponent(SOURCE)
        const clientMkId = () => 'CLIENT'
        const build = (host: Element, _props: unknown) =>
            new Function('host', 'mkId', clientBody)(host, clientMkId)
        const host = document.createElement('div')
        withPath(ROUTE, () => mount(host, build))

        expect(host.textContent).toBe('CLIENT')
    })

    test('a key mismatch (different route) does not adopt — the init stands', () => {
        DOC_SEED[SCOPE_ID] = encodeRefJson({ id: 'SERVER' })
        const clientBody = compileComponent(SOURCE)
        const clientMkId = () => 'CLIENT'
        const build = (host: Element, _props: unknown) =>
            new Function('host', 'mkId', clientBody)(host, clientMkId)
        const host = document.createElement('div')
        // Mount under a different route → scope id differs from the seed key → no adoption.
        withPath('/other/route', () => mount(host, build))

        expect(host.textContent).toBe('CLIENT')
    })
})
