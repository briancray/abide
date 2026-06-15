import { installMiniDom } from '../tests/support/installMiniDom.ts'

installMiniDom()

const { doc } = await import('../src/lib/ui/doc.ts')
const { mount } = await import('../src/lib/ui/dom/mount.ts')
const { each } = await import('../src/lib/ui/dom/each.ts')
const { text } = await import('../src/lib/ui/dom/text.ts')

/*
Render-layer benchmark (absolute, mini-DOM). Measures mounting a keyed list of N
rows and then updating one row's field M times — the fine-grained path where a
field change wakes exactly one text node, no list reconcile (shape-only). Run:

  bun packages/belte/bench/render.bench.ts

Svelte isn't compared here: its push-effect scheduler doesn't run headless under
Bun, so a fair DOM comparison needs a browser harness. These are belte absolutes.
*/

const ROWS = 5_000
const FIELD_UPDATES = 50_000

function buildModel(rows: number) {
    const order = Array.from({ length: rows }, (_, index) => String(index))
    const byId: Record<string, { n: number }> = {}
    for (const key of order) {
        byId[key] = { n: 0 }
    }
    return doc({ order, byId })
}

const model = buildModel(ROWS)
const host = document.createElement('div')

const mountStart = performance.now()
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
const mountMs = performance.now() - mountStart

const updateStart = performance.now()
for (let update = 0; update < FIELD_UPDATES; update += 1) {
    model.replace(`byId/${update % ROWS}/n`, update)
}
const updateMs = performance.now() - updateStart

console.log(`\nrender layer (mini-DOM), ${ROWS} rows\n`)
console.log(`mount ${ROWS} rows         ${mountMs.toFixed(1).padStart(8)}ms`)
console.log(
    `${FIELD_UPDATES} field updates  ${updateMs.toFixed(1).padStart(8)}ms` +
        `   ${((updateMs / FIELD_UPDATES) * 1000).toFixed(3)}µs/update (one text node each, no reconcile)\n`,
)
