// 32.16, 32.96 — A `{#try}`'S `{:pending}` ARM STANDS IN FOR ITS BODY ON THE BODY'S FIRST LOAD: while
// a value its body reads has never landed, on the server as it renders and in the browser as the
// body mounts — and once the body has stood, never again.

import { afterAll, expect, test } from 'bun:test'

import { parseAbide } from '#compiler'
import { flushSync } from '#shared'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// `land` settles the rate; until it is called the rate is on its first load. `late` never lands, and
// is read only once `more` is ticked.
const PAGE = `<script>
import { reactive } from '@abide/abide'

const rate = reactive(new Promise<number>((resolve) => {
    ;(globalThis as { land?: (rate: number) => void }).land = resolve
}))
const late = reactive(new Promise<number>(() => {}))
let more = reactive(false)
</script>

<input id="more" type="checkbox" bind:checked={more}>
{#try}
    <p id="body">rate {rate}{#if more} and {late}{/if}</p>
{:pending}
    <p id="pending">loading</p>
{/try}`

const land = (rate: number): void =>
    (globalThis as { land?: (rate: number) => void }).land?.(rate)
const shown = (): string =>
    document.getElementById('body')?.textContent ??
    document.getElementById('pending')?.textContent ??
    ''

// 32.96 ON THE SERVER — THE ARM IS PAINTED IN PLACE OF A BODY A READ IN IT ABORTED, opening on the
// anchor that names it. THE REVERT: return `__body` whatever `abortedSince` says in `renderMarkup`;
// the document holds the body with a hole where the rate goes, and no `loading`.
test('the server paints the {:pending} arm where a read in the body is still in flight — 32.96', async () => {
    const { html } = await renderPage(PAGE)
    expect(html).toContain('<p id="pending">loading</p>')
    expect(html).not.toContain('id="body"')
})

// 32.96 IN THE BROWSER — THE PAINTED ARM IS HYDRATED, AND THE VALUE LANDING IS THE BODY: then a value
// in flight the body reads later is a hole in the body (32.23), not the arm again. THE REVERT: drop
// `!this.loaded` from `waits`; ticking `more` puts `loading` back.
test('a first load shows the {:pending} arm until the value lands, and never again — 32.96', async () => {
    const { scope } = await mountPage(PAGE)
    expect(shown()).toBe('loading')
    land(5)
    await Promise.resolve()
    flushSync()
    expect(shown()).toBe('rate 5')
    document.getElementById('more')?.click()
    flushSync()
    expect(shown()).toBe('rate 5 and ')
    scope.stop()
})

// 32.96 — A FIRST LOAD THE BROWSER MEETS, where no server painted: a `{#try}` built after the page
// loaded, reading a value still in flight. THE REVERT: drop the `waits` arm of `guard`; the body
// stands with a hole where the rate goes — `rate ` where `loading` is due.
test('a {#try} the browser builds over a value in flight shows its {:pending} arm — 32.96', async () => {
    const { scope } = await mountPage(`<script>
import { reactive } from '@abide/abide'

let open = reactive(false)
const rate = reactive(new Promise<number>((resolve) => {
    ;(globalThis as { land?: (rate: number) => void }).land = resolve
}))
</script>

<input id="open" type="checkbox" bind:checked={open}>
{#if open}
    {#try}<p id="body">rate {rate}</p>{:pending}<p id="pending">loading</p>{/try}
{/if}`)
    expect(shown()).toBe('')
    document.getElementById('open')?.click()
    flushSync()
    expect(shown()).toBe('loading')
    land(7)
    await Promise.resolve()
    flushSync()
    expect(shown()).toBe('rate 7')
    scope.stop()
})

// 32.16 — A FIRST LOAD THAT FAILED BEFORE HYDRATION TAKES THE CATCH over the `{:pending}` arm the
// server painted, rather than adopting the pending markup as the catch. THE REVERT: have
// `TryRegion.paintedOther` answer false again; `loading` stands where `refused` is due.
test('a {:pending} arm the server painted gives way to the catch where the value failed by hydration — 32.16', async () => {
    const { scope } = await mountPage(`<script>
import { isServer, reactive } from '@abide/abide'

const rate = reactive((): Promise<number> => {
    if (!isServer()) throw new Error('refused')
    return new Promise<number>(() => {})
})
</script>

{#try}
    <p id="body">rate {rate}</p>
{:pending}
    <p id="pending">loading</p>
{:catch error}
    <p id="caught">{(error as Error).message}</p>
{/try}`)
    flushSync()
    expect(
        document.getElementById('caught')?.textContent ??
            document.getElementById('pending')?.textContent,
    ).toBe('refused')
    scope.stop()
})

// 32.16 — AND A FIRST LOAD THAT FAILS AFTER HYDRATION takes the catch too. THE REVERT: have the
// retry in `TryRegion.startRetry` set a failure only over none, as before; the `PENDING` the first
// load holds stays — `loading` where `refused` is due.
test('a first load that fails after hydration takes the catch — 32.16', async () => {
    const { scope } = await mountPage(`<script>
import { reactive } from '@abide/abide'

const rate = reactive(new Promise<number>((_, reject) => {
    ;(globalThis as { refuseRate?: (error: Error) => void }).refuseRate = reject
}))
</script>

{#try}
    <p id="body">rate {rate}</p>
{:pending}
    <p id="pending">loading</p>
{:catch error}
    <p id="caught">{(error as Error).message}</p>
{/try}`)
    expect(document.getElementById('pending')?.textContent).toBe('loading')
    ;(globalThis as { refuseRate?: (error: Error) => void }).refuseRate?.(
        new Error('refused'),
    )
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
    expect(
        document.getElementById('caught')?.textContent ??
            document.getElementById('pending')?.textContent,
    ).toBe('refused')
    scope.stop()
})

// 32.96 — A READ INSIDE A `{#try}` THE BODY HOLDS IS THAT ONE'S, so the outer body paints. THE
// REVERT: drop the `finally` that puts the count back in `renderMarkup`; the inner abort counts for
// the outer `{#try}` and it paints `loading`.
test('a read inside a nested {#try} is not the outer first load — 32.96', async () => {
    const { html } = await renderPage(`<script>
import { reactive } from '@abide/abide'

const late = reactive(new Promise<number>(() => {}))
</script>

{#try}
    <p id="outer">outer</p>
    {#try}<p>{late}</p>{/try}
{:pending}
    <p id="pending">loading</p>
{/try}`)
    expect(html).toContain('<p id="outer">outer</p>')
    expect(html).not.toContain('loading')
})

// 32.56 — THE ARM IS A `{#try}`'S ALONE. THE REVERT: drop `:pending` from the arm test in
// `parseAbide`; the tag is read as an expression, and refused as no block abide has (32.65).
test('a {:pending} outside a {#try} is refused — 32.56', () => {
    let refused = ''
    try {
        parseAbide('{#if a}x{:pending}y{/if}')
    } catch (thrown) {
        refused = String(thrown)
    }
    expect(refused).toContain('RULEBOOK 32.56')
})
