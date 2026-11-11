// A BLOCK UPDATES BEFORE WHAT IT HOLDS (RULEBOOK 12.18). The narrowing an `{#if page}` promises its
// body only holds if the body never runs once `page` has gone: an inner block reached through a
// DERIVED value is woken by the same write as the block around it, and the drain's queue is in the
// order the mark walk found them — which follows whichever subscribed to `page` first, and a reader
// list keeps no order. The inner chain then ran first, moved past `{#if section}` and read
// `page.kind` off `undefined`, reported through `reportError` while the page itself came out right.
//
// THE REVERT, for all three: drop `settleEnclosing` from the drain (`Reactive.ts`). Each reports
// one `TypeError: undefined is not an object (evaluating 'page().kind')`.

import { afterAll, expect, test } from 'bun:test'

import { click } from './click.ts'
import { closeTyped, mountPage } from './typed.ts'

afterAll(closeTyped)

/** Mounts `source`, clicks `#close`, and answers what reached `reportError` on the way. */
async function reportedOnClose(
    source: string,
    components: Record<string, string> = {},
): Promise<unknown[]> {
    const reported: unknown[] = []
    const original = globalThis.reportError
    globalThis.reportError = (thrown: unknown): void => {
        reported.push(thrown)
    }
    try {
        await mountPage(source, components)
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
