// 51.152-51.155 — `spoiler`, a cover standing in for content until it is pressed.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, jsonSchema, reactive, spoiler } from '#shared'

import { bindPart } from './bindPart.ts'

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

// THE REVERT: hide the content with `until-found`, as a disclosure's region is, and find in page
// reaches what the cover stands in for — `hidden` reads `'until-found'`, not `true`.
test('the content is hidden outright until the cover is pressed, and the cover then hides — 51.152, 51.153, 51.154, 51.155', () => {
    const secret = spoiler()
    expect([
        secret.cover.hidden,
        secret.content.hidden,
        secret.content['data-open'],
    ]).toEqual([false, true, undefined])
    ;(secret.cover.onclick as () => void)()
    flushSync()
    expect([
        secret.open(),
        secret.cover.hidden,
        secret.content.hidden,
        secret.content['data-open'],
    ]).toEqual([true, true, false, ''])
})

// THE REVERT: drop the focus from the cover's click, and focus stays on the cover it just hid —
// `activeElement` reads the button.
test('pressing the cover hands focus to the content — 51.152', async () => {
    const secret = spoiler()
    const cover = document.createElement('button')
    const content = document.createElement('span')
    document.body.append(cover, content)
    content.tabIndex = -1
    bound.push(bindPart(secret.content, content))
    cover.focus()
    ;(secret.cover.onclick as () => void)()
    flushSync()
    await Promise.resolve()
    expect(document.activeElement).toBe(content)
})

test('an `open` of the app’s own covers the content again', () => {
    const open = reactive(true)
    const secret = spoiler({ open })
    expect(secret.content.hidden).toBe(false)
    open.set(false)
    expect([secret.cover.hidden, secret.content.hidden]).toEqual([false, true])
})

// THE REVERT: queue the focus whatever the write answered, and a refused press hands focus to content
// that stays hidden — `activeElement` reads the span.
test('a press whose opening is refused leaves the cover and its focus — 49.19', async () => {
    const open = reactive<boolean>(false, {
        schema: jsonSchema<boolean>({ enum: [false] }),
    })
    const secret = spoiler({ open })
    const cover = document.createElement('button')
    const content = document.createElement('span')
    document.body.append(cover, content)
    content.tabIndex = -1
    bound.push(bindPart(secret.content, content))
    cover.focus()
    ;(secret.cover.onclick as () => void)()
    flushSync()
    await Promise.resolve()
    expect([open(), secret.content.hidden]).toEqual([false, true])
    expect(document.activeElement).toBe(cover)
})
