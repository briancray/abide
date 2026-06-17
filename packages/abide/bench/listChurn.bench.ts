import { installMiniDom } from '../tests/support/installMiniDom.ts'
import { emitMetric } from './emitMetric.ts'

installMiniDom()

const { doc } = await import('../src/lib/ui/doc.ts')
const { mount } = await import('../src/lib/ui/dom/mount.ts')
const { each } = await import('../src/lib/ui/dom/each.ts')
const { text } = await import('../src/lib/ui/dom/text.ts')

/*
List-reconcile churn benchmark (mini-DOM). render.bench measures a field edit
inside a stable list — the shape-only path that wakes one text node. This one
measures the structural path the field bench never touches: append, remove, and
reorder of a keyed `each`, each driving a reconcile and (for reorder/remove) the
createDoc descend scan over the minted-path registry. This is where the flat-Map
`startsWith` scan in `wakeSubtree` shows up, and the gate that says whether a
segment trie is worth it. Run:

  bun packages/abide/bench/listChurn.bench.ts
*/

function ms(start: number): number {
    return performance.now() - start
}

function report(metricName: string, label: string, elapsed: number, ops: number): void {
    const perOp = (elapsed / ops) * 1000
    console.log(
        `${label.padEnd(26)} ${elapsed.toFixed(1).padStart(8)}ms   ${perOp.toFixed(3).padStart(9)}µs/op`,
    )
    emitMetric(metricName, perOp, 'us/op')
}

/* Mounts a keyed list of `rows` over a fresh doc, returns the model + host. */
function mountList(rows: number) {
    const order = Array.from({ length: rows }, (_, index) => String(index))
    const byId: Record<string, { n: number }> = {}
    for (const key of order) {
        byId[key] = { n: Number(key) }
    }
    const model = doc({ order, byId })
    const host = document.createElement('div')
    mount(host, (root) => {
        const list = document.createElement('ul')
        each(
            list,
            () => model.read<string[]>('order'),
            (key) => key,
            (key) => {
                const li = document.createElement('li')
                li.appendChild(text(() => model.read(`byId/${key}/n`)))
                return li
            },
        )
        root.appendChild(list)
    })
    return model
}

/* Append churn: add one row at the end, the non-shifting-add fast path. */
function appendChurn(rows: number, ops: number): number {
    const model = mountList(rows)
    const start = performance.now()
    for (let op = 0; op < ops; op += 1) {
        const key = String(rows + op)
        model.replace(`byId/${key}`, { n: op })
        model.add('order/-', key)
    }
    return ms(start)
}

/* Remove churn: drop the head row, the index-shifting structural path. */
function removeChurn(rows: number, ops: number): number {
    const model = mountList(rows + ops)
    const start = performance.now()
    for (let op = 0; op < ops; op += 1) {
        model.remove('order/0')
    }
    return ms(start)
}

/* Reorder churn: reverse the whole order array — a structural replace that wakes
   the parent and descend-scans every minted descendant to pick up index shifts. */
function reorderChurn(rows: number, ops: number): number {
    const model = mountList(rows)
    const current = model.snapshot() as { order: string[] }
    const start = performance.now()
    for (let op = 0; op < ops; op += 1) {
        const reversed = [...(model.snapshot() as { order: string[] }).order].reverse()
        model.replace('order', reversed)
    }
    const elapsed = ms(start)
    return current === undefined ? 0 : elapsed
}

/* Warm the JIT. */
appendChurn(100, 200)
removeChurn(100, 200)
reorderChurn(100, 50)

console.log('\nlist reconcile churn (mini-DOM)\n')

report('listChurn.append', 'append (1k base)', appendChurn(1_000, 2_000), 2_000)
report('listChurn.removeHead', 'remove head (3k base)', removeChurn(3_000, 2_000), 2_000)
report('listChurn.reorder', 'reorder reverse (500)', reorderChurn(500, 500), 500)
console.log()
