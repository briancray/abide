import { describe, expect, test } from 'bun:test'
import packageJson from '../package.json' with { type: 'json' }
import { UI_RUNTIME_IMPORTS } from '../src/lib/ui/compile/UI_RUNTIME_IMPORTS.ts'

/*
`UI_RUNTIME_IMPORTS` is a hand-maintained list the compiler emits as the import block
of every component module. Two ways it can silently drift, each guarded here against an
INDEPENDENT source of truth (so the guard can't share the list's own blind spot):

  1. A stale/typo'd entry — a `specifier` whose module was renamed or removed — emits an
     import that 404s only when a bundle is built. Checked against the package `exports`
     map: every entry must resolve to a real subpath.
  2. The dev hot-module bridge (`window.__abide`) destructures these same names; a name
     listed here but absent from the bridge breaks component HMR. Checked against the
     bridge's published surface.
*/

describe('UI_RUNTIME_IMPORTS stays consistent with reality', () => {
    test('every entry resolves to a real package export', () => {
        const exportKeys = new Set(Object.keys(packageJson.exports))
        const missing = UI_RUNTIME_IMPORTS.filter(
            (entry) => !exportKeys.has(`./${entry.specifier}`),
        ).map((entry) => `${entry.name} -> ./${entry.specifier}`)
        expect(missing).toEqual([])
    })
})
