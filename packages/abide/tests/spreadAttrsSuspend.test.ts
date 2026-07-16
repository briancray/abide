import { beforeAll, describe, expect, test } from 'bun:test'
import type { AsyncComputed } from '../src/lib/shared/types/AsyncComputed.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { readCell } from '../src/lib/ui/dom/readCell.ts'
import { restProps } from '../src/lib/ui/dom/restProps.ts'
import { spreadAttrs } from '../src/lib/ui/dom/spreadAttrs.ts'
import type { UiProps } from '../src/lib/ui/runtime/types/UiProps.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

beforeAll(() => {
    installMiniDom()
})

/* Regression (the `/media` cold-remount crash): a `<Button {...rest}>` forwards `disabled` into
   `<button {...rest}>`, and its value reads a still-PENDING blocking `await` cell. `spreadAttrs`
   guards the enumeration (`source()` returns the restProps proxy — no value read, no throw), but
   the suspend fires LATER, on the per-key value read inside `bindKeys` as the proxy `get` invokes
   the prop thunk — outside the enumeration guard. That `SuspenseSignal` must be swallowed and the
   key bound as a deferred attribute (like `attr`'s own branch), not escape and kill the mount. */
describe('spreadAttrs — per-key suspend through a restProps proxy', () => {
    test('a rest key reading a pending blocking cell defers instead of throwing', async () => {
        // A primitive async computed joins the SSR barrier → blocking: a pending read suspends
        // (ADR-0042), exactly like the page's `sessionData` cell during the back-nav remount.
        const filters = computed(async () => ({ q: 'jazz' })) as AsyncComputed<{ q: string }>
        // The child receives prop THUNKS; `data-q` reads the blocking cell (mirrors
        // `disabled={!areFiltersApplied}` → editedFilters → filters prop → pending).
        const props = {
            'data-q': () => (readCell(filters) as { q: string }).q,
        } as unknown as UiProps
        const rest = restProps(props, [])
        const button = document.createElement('button')

        // Enumeration is safe; the per-key value read used to escape here. It must not now.
        expect(() => spreadAttrs(button, () => rest, [])).not.toThrow()
        // Withheld while pending — like `attr` and the deferred-enumeration branch.
        expect(button.hasAttribute('data-q')).toBe(false)

        // The suspended read tracked its cell, so the deferred `attr` effect re-runs on settle.
        await settle()
        expect(button.getAttribute('data-q')).toBe('jazz')
    })

    test('an `on*` handler rest key still attaches (the guard never diverts a handler)', () => {
        // The prop thunk returns a function WITHOUT reading a cell, so it never suspends — it must
        // stay on the `on()` path, not be misclassified as an attribute by the new try/catch.
        let clicks = 0
        const props = {
            onclick: () => () => {
                clicks += 1
            },
        } as unknown as UiProps
        const rest = restProps(props, [])
        const button = document.createElement('button')

        spreadAttrs(button, () => rest, [])
        button.dispatchEvent(new Event('click'))
        expect(clicks).toBe(1)
        expect(button.hasAttribute('onclick')).toBe(false)
    })
})
