// 13.5 — NO FREE `done`, `success`, `error` OR `issues` OVER A SELECTION: a probe is a value's own
// (`s.error()`), and only `busy` and `ready` are asked of a selection (13.3, 13.4).

import { expect, test } from 'bun:test'

import * as server from '#server'
import * as shared from '#shared'
import * as runtime from '#ui'

// THE REVERT: export an `error` from `#shared`'s barrel; it is named here, through `@abide/abide` and
// the server's re-export of it, where `[]` is due.
test('no entry exports a free done, success, error or issues — 13.5', () => {
    const named: string[] = []
    for (const [entry, module] of [
        ['@abide/abide', shared],
        ['@abide/abide/runtime', runtime],
        ['@abide/abide/server', server],
    ] as const)
        for (const name of ['done', 'success', 'error', 'issues'])
            if (name in module) named.push(`${entry}: ${name}`)
    expect(named).toEqual([])
})
