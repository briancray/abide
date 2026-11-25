// 51.68 with 49.19 — a command chosen while the palette's `open` refuses turning off. The parts are
// driven by hand; what a template does with them is the CRM's tests'.

import { expect, test } from 'bun:test'

import { commandPalette, flushSync, reactive } from '#shared'

// THE REVERT: run the command whatever `open` answered, and the Enter whose close was refused runs
// it under a palette still open — `ran` reads ['Archive deal'].
test('a command whose close `open` refuses is not run — 51.68, 49.19', () => {
    const gate = { refusing: false }
    const open = reactive<boolean>(false, {
        schema: {
            '~standard': {
                version: 1,
                vendor: 'test',
                validate: (value: unknown) =>
                    gate.refusing
                        ? { issues: [{ message: 'held open' }] }
                        : { value: value as boolean },
            },
        },
    })
    const ran: string[] = []
    const palette = commandPalette({
        open,
        commands: [
            { label: 'Archive deal', run: () => ran.push('Archive deal') },
        ],
    })
    open.set(true)
    flushSync()
    gate.refusing = true
    ;(palette.input.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    )
    flushSync()
    expect([open.peek(), ran]).toEqual([true, []])
    gate.refusing = false
    ;(palette.input.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    )
    flushSync()
    expect([open.peek(), ran]).toEqual([false, ['Archive deal']])
})
