// 38.145, 38.148 — THE UPDATE A DESKTOP APP'S WINDOW STAGED, AS A PAGE READS IT. The window is
// played by what it does to a page: an `abide:update` event in, and a message out on `abideUpdate`.

import { expect, test } from 'bun:test'

import { inReleasedScope } from '#server/requestScope.ts'
import { flushSync, pendingUpdate } from '#shared'

const told = (detail: unknown): void => {
    dispatchEvent(new CustomEvent('abide:update', { detail }))
    flushSync()
}

// THE REVERT is the `abide:update` listener dropped: the page reads `undefined` after the window
// tells it of 1.1.0. And `isServer()` dropped from the body: a request answers 1.1.0 too.
test('pendingUpdate holds what the window staged, and nothing on a server — 38.148', async () => {
    expect(pendingUpdate()).toBeUndefined()
    told({ version: '1.1.0', required: true, notes: 'Fixes export.' })
    try {
        const staged = pendingUpdate()
        expect(
            `${staged?.version} required ${staged?.required}: ${staged?.notes}`,
        ).toBe('1.1.0 required true: Fixes export.')
        const inRequest = await inReleasedScope(
            new Request('http://app/'),
            async () => pendingUpdate()?.version,
        )
        expect(`in a request ${inRequest}`).toBe('in a request undefined')
    } finally {
        told(null)
    }
    expect(pendingUpdate()).toBeUndefined()
})

// THE REVERT is `install` posting nothing: the window is never asked, and `posted` stays empty.
test('install asks the window to restart into the update — 38.145', () => {
    const posted: string[] = []
    const held = globalThis as { webkit?: unknown }
    held.webkit = {
        messageHandlers: {
            abideUpdate: {
                postMessage: (message: string) => posted.push(message),
            },
        },
    }
    told({ version: '1.1.0', required: false, notes: undefined })
    try {
        pendingUpdate()?.install()
        expect(posted).toEqual(['install'])
    } finally {
        told(null)
        delete held.webkit
    }
})
