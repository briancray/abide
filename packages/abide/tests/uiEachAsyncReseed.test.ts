import { beforeAll, describe, expect, test } from 'bun:test'
import { eachAsync } from '../src/lib/ui/dom/eachAsync.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
import type { State } from '../src/lib/ui/runtime/types/State.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

type Row = { id: string; text: string }

/* A feed that yields its rows one per microtask, then parks on a gate — a socket-shaped source
   that stays open (never reaches `done`), so eachAsync's completion prune never runs while it's
   live. `release` completes the generator at cleanup. */
function gatedFeed(rows: Row[]): { feed: AsyncGenerator<Row>; release: () => void } {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    async function* generate(): AsyncGenerator<Row> {
        for (const row of rows) {
            await Promise.resolve()
            yield row
        }
        await gate
    }
    return { feed: generate(), release }
}

async function flush(): Promise<void> {
    for (let tick = 0; tick < 12; tick += 1) {
        await Promise.resolve()
    }
}

/* All `<li data-id>` values under `host`, in document order. */
function rowIds(host: Node): (string | null)[] {
    const ids: (string | null)[] = []
    const walk = (node: Node): void => {
        for (const child of (node as unknown as { childNodes: Node[] }).childNodes ?? []) {
            if ((child as unknown as { tagName?: string }).tagName === 'li') {
                ids.push((child as unknown as Element).getAttribute('data-id'))
            }
            walk(child)
        }
    }
    walk(host)
    return ids
}

/* Drive eachAsync directly (no compiler / reactive doc) so the block tears down cleanly via the
   scope disposer — a reactive doc holding an async generator leaves cross-file state that a later
   synchronous-reactivity test trips over. */
describe('<template each await> reseed', () => {
    test('a reseed clears the prior source rows — no leak from a never-completing feed', async () => {
        const roomA = gatedFeed([
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
        ])
        const roomB = gatedFeed([{ id: 'c', text: 'C' }])
        const source = state<AsyncIterable<Row>>(roomA.feed)
        const host = document.createElement('div')

        const render = (parent: Node, item: State<Row>): void => {
            const li = document.createElement('li')
            li.setAttribute('data-id', item.value.id)
            li.textContent = item.value.text
            parent.appendChild(li)
        }

        const dispose = scope(() => {
            eachAsync(
                host,
                () => source.value,
                (row) => row.id,
                render,
                undefined,
                null,
                true,
            )
        })

        await flush()
        expect(rowIds(host)).toEqual(['a', 'b'])

        /* Switch to a different source (like switching rooms). Both feeds stay open (never `done`),
           so the completion prune never fires for either; without clearing on reseed, `a`/`b` would
           leak alongside `c`. */
        source.value = roomB.feed
        await flush()
        expect(rowIds(host)).toEqual(['c'])

        /* Tear the block down and complete both feeds so nothing dangles into the next test file. */
        dispose()
        roomA.release()
        roomB.release()
        await flush()
    })
})
