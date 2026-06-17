import { describe, expect, test } from 'bun:test'
import { hoistCells } from '../src/lib/ui/compile/hoistCells.ts'
import { lowerDocAccess } from '../src/lib/ui/compile/lowerDocAccess.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { effect } from '../src/lib/ui/effect.ts'
import type { Doc } from '../src/lib/ui/runtime/types/Doc.ts'

function squash(code: string): string {
    return code.replace(/\s+/g, ' ').trim()
}

describe('hoistCells — emitted shape', () => {
    test('a repeated static read hoists to one shared cell', () => {
        const out = squash(hoistCells('model.read("count") + model.read("count")', 'model'))
        expect(out).toContain('const _cell0 = model.cell("count")')
        expect(out).toContain('_cell0.get() + _cell0.get()')
        // one cell declaration, not two
        expect(out.match(/model\.cell\(/g)?.length).toBe(1)
    })

    test('a static replace becomes a cell set sharing the read cell', () => {
        const out = squash(hoistCells('model.replace("count", model.read("count") + 1)', 'model'))
        expect(out).toContain('const _cell0 = model.cell("count")')
        expect(out).toContain('_cell0.set(_cell0.get() + 1)')
        expect(out.match(/model\.cell\(/g)?.length).toBe(1)
    })

    test('dynamic-path reads are left as read()', () => {
        const out = squash(hoistCells('model.read("lines/" + i + "/sku")', 'model'))
        expect(out).toContain('model.read("lines/" + i + "/sku")')
        expect(out).not.toContain('model.cell(')
    })
})

/* The script-side composition the component compiler applies: lower idiomatic
   data access on `model`, then hoist its static paths to cells. */
function lowerAndHoist(body: string): string {
    return hoistCells(lowerDocAccess(body, 'model'), 'model')
}

function run(document: Doc, body: string): unknown {
    return new Function('model', lowerAndHoist(body))(document)
}

describe('lowering + hoisting executes correctly', () => {
    test('author code becomes cell-based and runs', () => {
        const compiled = lowerAndHoist("model.note = 'x'; return model.note")
        expect(compiled).toContain('model.cell("note")')
        expect(compiled).toContain('.set(')
        expect(compiled).toContain('.get()')
        const d = doc({ note: 'a' })
        expect(run(d, "model.note = 'x'; return model.note")).toBe('x')
        expect(d.read<string>('note')).toBe('x')
    })

    test('compound assignment round-trips through one cell', () => {
        const d = doc({ count: 10 })
        run(d, 'model.count += 5')
        expect(d.read<number>('count')).toBe(15)
    })

    test('a compiled cell set wakes a reader of the same path', () => {
        const d = doc({ count: 0 })
        let observed = 0
        let runs = 0
        effect(() => {
            observed = d.read<number>('count')
            runs += 1
        })
        expect(runs).toBe(1)
        run(d, 'model.count = 7') // compiled to _cell.set(7)
        expect(observed).toBe(7)
        expect(runs).toBe(2) // the reader woke through the same path node
    })
})
