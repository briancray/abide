// The REPL's opening screen, per surface.
//
// Two things are easy to get wrong here and neither shows up in a unit test of the pieces: styling a
// stream nobody is looking at (a pipe gets ANSI escapes it then has to strip), and advertising keys
// that do nothing on this surface (`TAB completes` down a pipe, `→ accepts the hint` under NO_COLOR).
// Both are asserted against the real `interactiveCli`.

import { afterEach, describe, expect, test } from 'bun:test'
import type { CliCommand } from './cliCommands.ts'
import type { CommandTarget } from './commandTarget.ts'
import { interactiveCli } from './interactiveCli.ts'

const COMMANDS: CliCommand[] = ['alpha', 'beta', 'gamma'].map((name) => ({
    name,
    method: 'GET',
    read: true,
    schemaKnown: true,
    fields: [],
}))

// `origin()` is what boots the embedded app; opening a session must not.
const TARGET: CommandTarget = {
    origin: (): Promise<string> => Promise.reject(new Error('must not boot')),
    host: (): Promise<string> => Promise.resolve('http://localhost:0'),
    hosting: (): undefined => undefined,
    remote: (): undefined => undefined,
    retarget: (): void => {},
    stop: (): Promise<void> => Promise.resolve(),
}

async function banner(): Promise<string> {
    const out: string[] = []
    await interactiveCli({
        name: 'demo',
        commands: COMMANDS,
        target: TARGET,
        flags: {},
        pretty: false,
        // The pipe adapter — the only one drivable without a terminal. FORCE_COLOR below is what
        // exercises the styled branch, which is exactly the situation it exists for.
        tty: false,
        input: new Response('exit\n').body as ReadableStream<Uint8Array>,
        write: (text) => out.push(text),
        writeError: (text) => out.push(text),
    })
    return out.join('')
}

// The ANSI CSI introducer. Spelled `\x1b` rather than carried as a LITERAL escape byte in the
// source, which is invisible in every editor and does not survive a copy-paste.
// Matching the ANSI CSI introducer IS the test: these assertions exist to prove the styled branch
// emitted escapes and the NO_COLOR branch did not, so the control character is the subject rather
// than a stray paste. Spelled `\x1b` rather than carried as a literal escape BYTE in the source,
// which is invisible in every editor and does not survive a copy-paste.
// biome-ignore lint/suspicious/noControlCharactersInRegex: see above — the escape is the subject.
const ESCAPE = /\x1b\[/

const previous = { no: Bun.env.NO_COLOR, force: Bun.env.FORCE_COLOR }
afterEach(() => {
    for (const [name, value] of [
        ['NO_COLOR', previous.no],
        ['FORCE_COLOR', previous.force],
    ] as const) {
        if (value === undefined) delete Bun.env[name]
        else Bun.env[name] = value
    }
})

describe('the REPL banner', () => {
    test('a pipe gets no ANSI escapes at all', async () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        const text = await banner()
        expect(text).not.toMatch(ESCAPE)
        // …and the plain prompt, not the styled glyph.
        expect(text).toContain('> ')
    })

    test('a pipe advertises neither TAB nor the hint — it has neither', async () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        const text = await banner()
        expect(text).toContain('3 commands')
        expect(text).not.toContain('TAB completes')
        expect(text).not.toContain('accepts the hint')
    })

    test('FORCE_COLOR styles it, and NO_COLOR wins over FORCE_COLOR', async () => {
        Bun.env.FORCE_COLOR = '1'
        expect(await banner()).toMatch(ESCAPE)

        Bun.env.NO_COLOR = '1'
        // The conventional precedence: a refusal beats an insistence.
        expect(await banner()).not.toMatch(ESCAPE)
    })

    test('the command list is columnised, not a comma wall', async () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        const text = await banner()
        expect(text).not.toContain('alpha, beta, gamma')
        // Each name indented on a laid-out row.
        expect(text).toContain('alpha')
        expect(text).toContain('gamma')
    })
})
