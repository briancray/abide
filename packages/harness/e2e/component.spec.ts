// WHAT A COMPONENT COSTS A ROW IN A BROWSER. `bun run bench:component` prices the server half —
// the render — and this is the other half a reader waits on: the mount, where the caller builds
// one accessor per prop per row (33.4) and the child mounts against its own anchors (32.17).
//
// THE ARMS ARE THE SAME CARD. The component's body is byte-identical to the inline row's, so the
// ratio is the invocation and nothing else. Both pages are built by `buildCompiledPage`, from one
// shell, for the reason that file already states: two arms differing in anything but the
// implementation are two implementations of different pages.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import type { Sample } from 'harness/report'
import { type Report, reportScript } from './reportScript.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const REPORT = reportScript()
const SIZES = [100, 1000]

type Arm = { script: string; markup: string }
type Card = { id: number; title: string; body: string; count: number }
type Built = { size: number; list: Card[]; inline: Arm; nested: Arm }

// A WRITE HANDLE ON EACH PAGE'S LIST, so a test can prove the mount BOUND the rows it adopted: a
// `{#for}` hydrating server rows writes nothing until a value changes, so a slot blanked before
// the mount stays blank either way. One statement per mount, in both arms alike.
const HANDLE = `let rows = reactive(CARDS)
;(globalThis as Record<string, unknown>).__SET_ROWS__ = (next: never) => {
    rows = next
}`

const pages = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/harness/scripts/buildCompiledPage.ts'
import { abideCardSource, abideComponentSource, abideLoopSource, cards } from './packages/harness/scripts/renderCases.ts'
const out = []
const handled = (source) => {
    if (!source.includes('let rows = reactive(CARDS)')) throw new Error('no list to put a handle on')
    return source.replace('let rows = reactive(CARDS)', ${JSON.stringify(HANDLE)})
}
for (const size of ${JSON.stringify(SIZES)}) {
    const list = cards(size)
    const flat = await buildCompiledPage(handled(abideLoopSource()).replace('CARDS', JSON.stringify(list)))
    const nested = await buildCompiledPage(
        handled(abideComponentSource()).replace('CARDS', JSON.stringify(list)),
        { Card: abideCardSource() },
    )
    out.push({ size, list, inline: flat, nested })
}
console.log(JSON.stringify(out))
`,
        ],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as Built[]

// WEBKIT CANNOT PRICE THESE INSIDE A GATE: its clock is 1 ms, so 44.11's bar is 100 ms a sample
// and `batch()` refuses rather than report the clock. `list.spec.ts` carries the whole reason.
test.skip(
    ({ browserName }) => browserName === 'webkit',
    'webkit coarsens its clock to 1 ms; 44.11 cannot be met inside a gate budget',
)

type Mounts = {
    mount: (root: Node) => void
    flush: () => void
    markup: string
    setRows: () => (next: Card[]) => void
}

test('the mount of a list of components, against the same rows inline', async ({
    page,
}, testInfo) => {
    test.setTimeout(5 * 60 * 1000)
    const lines = [`\n=== ${testInfo.project.name} — a component per row ===`]

    for (const built of pages) {
        // BOTH ARMS IN ONE PAGE, so `batch()` can interleave them. Each compiled script is an
        // IIFE carrying its own runtime and leaves its mount on the one global, so each is
        // taken off it before the next script lands.
        await page.goto('about:blank')
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({ content: REPORT })
        for (const [name, arm] of [
            ['inline', built.inline],
            ['nested', built.nested],
        ] as const) {
            await page.addScriptTag({ content: arm.script })
            await page.evaluate(
                ({ name, markup }) => {
                    const page = globalThis as unknown as Record<
                        string,
                        unknown
                    >
                    page[`__${name}__`] = {
                        mount: page.__MOUNT_INTO__,
                        flush: page.__FLUSH__,
                        markup,
                        // Read AFTER a mount: each mount sets it, and the last one is the host's.
                        setRows: () => page.__SET_ROWS__,
                    }
                },
                { name, markup: arm.markup },
            )
        }

        // EACH ARM HYDRATES THE DOCUMENT ITS OWN SERVER WROTE, anchors and all: the component
        // page's markup carries a pair per row that the inline page's does not, and that
        // difference is part of what is being priced rather than something to equalise away.
        const measured = await page.evaluate(
            ({ size, list }) => {
                const { batch, claimOf, emulatedDom, ratio } = (
                    globalThis as unknown as { __REPORT__: Report }
                ).__REPORT__
                const page = globalThis as unknown as {
                    __inline__: Mounts
                    __nested__: Mounts
                }
                // EVERY ROW WRITTEN THROUGH THE MOUNT AND READ BACK. A mount that bound nothing is the
                // fastest arm on the table, and a list it never took over keeps the server's text. Read
                // off the host AFTER the write rather than off nodes held from before: a row whose item
                // is a new object is rebuilt, so the server's nodes are gone either way.
                const changed: Card[] = []
                for (const card of list)
                    changed.push({
                        id: card.id,
                        title: `${card.title}!`,
                        body: `${card.body}!`,
                        count: card.count + 100,
                    })
                const bound = (arm: Mounts): number => {
                    const host = document.createElement('div')
                    document.body.appendChild(host)
                    host.innerHTML = arm.markup
                    arm.mount(host)
                    arm.flush()
                    arm.setRows()(changed)
                    arm.flush()
                    let count = 0
                    let row = 0
                    for (const card of host.querySelectorAll(
                        '#list > article',
                    )) {
                        const owed = changed[row] as Card
                        row += 1
                        if (card.children[0]?.textContent === owed.title)
                            count += 1
                        if (card.children[1]?.textContent === owed.body)
                            count += 1
                        if (
                            card.children[2]?.textContent === String(owed.count)
                        )
                            count += 1
                    }
                    host.remove()
                    return count
                }
                const inlineBound = bound(page.__inline__)
                const nestedBound = bound(page.__nested__)

                const inlineHost = document.createElement('div')
                const nestedHost = document.createElement('div')
                document.body.append(inlineHost, nestedHost)
                const timed = batch({
                    case: `mount ${size} rows`,
                    arms: {
                        inline: () => {
                            inlineHost.innerHTML = page.__inline__.markup
                            page.__inline__.mount(inlineHost)
                        },
                        component: () => {
                            nestedHost.innerHTML = page.__nested__.markup
                            page.__nested__.mount(nestedHost)
                        },
                    },
                    emulated: emulatedDom(),
                    work: {
                        inline: { slotsBound: inlineBound },
                        component: { slotsBound: nestedBound },
                    },
                    budgetNanoseconds: 20_000_000_000,
                })
                document.body.replaceChildren()
                const inline = timed.samples.inline as Sample
                const component = timed.samples.component as Sample
                const verdict = ratio(component, inline, { floor: timed.floor })
                return {
                    inline: inline.nanoseconds,
                    component: component.nanoseconds,
                    claim: claimOf(verdict),
                    n: timed.n,
                    floor: timed.floor,
                    inlineBound,
                    nestedBound,
                    workDisagreement: verdict.workDisagreement,
                }
            },
            { size: built.size, list: built.list },
        )

        // Reverted — the component page's mount swapped for one that binds nothing — this
        // reads 0 of 300 at 100 rows.
        expect(
            measured.inlineBound,
            'the inline mount left slots unbound',
        ).toBe(built.size * 3)
        expect(
            measured.nestedBound,
            'the component mount left slots unbound',
        ).toBe(built.size * 3)
        lines.push(
            `  ${String(built.size).padStart(4)} rows   inline ${(measured.inline / 1000).toFixed(1)} µs   component ${(measured.component / 1000).toFixed(1)} µs   ${measured.claim}   [n=${measured.n} floor=${(measured.floor * 100).toFixed(2)}%]` +
                `\n              ${(measured.inline / built.size).toFixed(0)} ns a row inline, ${(measured.component / built.size).toFixed(0)} ns a row as a component`,
        )
        if (measured.workDisagreement.length > 0)
            lines.push(
                `              WORK DISAGREES — ${measured.workDisagreement.join('; ')}`,
            )
    }

    console.log(lines.join('\n'))
})
