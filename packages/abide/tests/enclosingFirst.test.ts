// A BLOCK UPDATES BEFORE WHAT IT HOLDS (RULEBOOK 12.18). The narrowing an `{#if page}` promises its
// body only holds if the body never runs once `page` has gone: an inner block reached through a
// DERIVED value is woken by the same write as the block around it, and the drain's queue is in the
// order the mark walk found them — which follows whichever subscribed to `page` first, and a reader
// list keeps no order. The inner chain then ran first, moved past `{#if section}` and read
// `page.kind` off `undefined`, reported through `reportError` while the page itself came out right.
//
// THE REVERT, for every page below: drop `settleEnclosing` from the drain (`Reactive.ts`). Each
// reports one `TypeError: undefined is not an object (evaluating 'page().kind')`.

import { afterAll, expect, test } from 'bun:test'

import { flushSync, reactive } from '#shared'
import { unowned, watch } from '#shared/reactive/watch.ts'

import { click } from './click.ts'
import { closeTyped, mountPage } from './typed.ts'

afterAll(closeTyped)

/**
 * Mounts `source`, waits for `arrived` where one is named, clicks `#close`, and answers what reached
 * `reportError` on the way.
 */
async function reportedOnClose(
    source: string,
    components: Record<string, string> = {},
    arrived?: string,
): Promise<unknown[]> {
    const reported: unknown[] = []
    const original = globalThis.reportError
    globalThis.reportError = (thrown: unknown): void => {
        reported.push(thrown)
    }
    try {
        await mountPage(source, components)
        if (arrived !== undefined)
            for (
                let tick = 0;
                document.querySelector(arrived) === null;
                tick += 1
            ) {
                if (tick === 100) throw new Error(`${arrived} never arrived`)
                await Bun.sleep(1)
            }
        click('#close')
    } finally {
        globalThis.reportError = original
    }
    return reported
}

/** The page's script and its close button, with `imports` added to the script. */
const script = (imports = ''): string => `<script>
import { reactive } from '@abide/abide'
${imports}
let page = reactive<{ kind: string } | undefined>({ kind: 'atlas' })
const section = reactive(() => (page?.kind === 'atlas' ? page.kind : undefined))
const rows = reactive(['a'])
</script>
<button id="close" onclick={() => (page = undefined)}>close</button>`

test('an inner {#if} does not run once the {#if} around it has gone false', async () => {
    const reported = await reportedOnClose(`${script()}
{#if page}
    {#if section}<p>{section}</p>{:else if page.kind === 'trail'}<p>trail</p>{/if}
{/if}`)
    expect(reported).toEqual([])
    expect(document.querySelector('p')).toBeNull()
})

test('nor through a {#for} between the two that the write did not wake', async () => {
    const reported = await reportedOnClose(`${script()}
{#if page}
    {#for row of rows by row}
        {#if section}<p>{section}</p>{:else if page.kind === 'trail'}<p>{row}</p>{/if}
    {/for}
{/if}`)
    expect(reported).toEqual([])
    expect(document.querySelector('p')).toBeNull()
})

// A COMPONENT'S PROP and the watches its setup opens are opened inside the arm's mount too.
test('nor does a component in the arm, through its prop or its watch', async () => {
    const reported = await reportedOnClose(
        `${script("import Child from './Child.abide'")}
{#if page}
    {#if section}<p>{section}</p>{:else}<Child kind={page.kind} />{/if}
{/if}`,
        {
            Child: `<script>
import { props, watch } from '@abide/abide'
const { kind } = props<{ kind: string }>()
watch(() => {
    void kind
})
</script>
<i>{kind}</i>`,
        },
    )
    expect(reported).toEqual([])
    expect(document.querySelector('i')).toBeNull()
})

// A ROW AN ASYNC SUBJECT APPENDS is mounted by the pump after an `await`, outside the `{#for}`'s
// update — so it is the `{#for}`'s update the pump opens it under.
test('nor does a row an async {#for} appended after its subject arrived', async () => {
    const reported = await reportedOnClose(
        `${script()}
{#if page}
    {#for row of (async function* () { yield 'a' })()}
        {#if section}<p>{section}</p>{:else if page.kind === 'trail'}<p>{row}</p>{/if}
    {/for}
{/if}`,
        {},
        'p',
    )
    expect(reported).toEqual([])
    expect(document.querySelector('p')).toBeNull()
})

// AN UNOWNED WATCH IS ENCLOSED BY NOTHING. It outlives the effect it was opened in — the page's head
// reconcile, a followed `GET`'s feed — so it must not wait on that effect, nor hold it reachable.
// Subscribed first, it runs first.
//
// THE REVERT: have `unowned` call `open()` rather than `openedUnder(null, open)`. The effect it was
// opened in is then settled ahead of it, and this reads `['opener', 'unowned']`.
test('a watch opened unowned inside an effect does not wait on it', () => {
    const source = reactive(0)
    const order: string[] = []
    let opened = false
    const stop = watch(() => {
        if (!opened) {
            opened = true
            unowned(() =>
                watch(() => {
                    source()
                    order.push('unowned')
                }),
            )
        }
        source()
        order.push('opener')
    })
    order.length = 0
    source.set(1)
    flushSync()
    stop()
    expect(order).toEqual(['unowned', 'opener'])
})
