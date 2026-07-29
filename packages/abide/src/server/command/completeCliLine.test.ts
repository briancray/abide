// What TAB offers. Asserted on the shared function rather than through each surface, because the
// point of it being shared is that the REPL and the shell answer identically — `lineReader.test.ts`
// covers that readline is actually wired to it, and `completion` shells out to the same call.

import { describe, expect, test } from 'bun:test'
import type { CliCommand } from './cliCommands.ts'
import { completeCliLine } from './completeCliLine.ts'

const COMMANDS: CliCommand[] = [
    {
        name: 'createNote',
        method: 'POST',
        read: false,
        schemaKnown: true,
        fields: [
            { name: 'title', type: 'string', required: true },
            { name: 'author', type: 'string', required: false, default: 'anon' },
            { name: 'pinned', type: 'boolean', required: false },
            { name: 'tag', type: 'array', required: false },
            { name: 'colour', type: 'string', required: false, enum: ['red', 'green', 'blue'] },
        ],
    },
    { name: 'createUser', method: 'POST', read: false, schemaKnown: true, fields: [] },
    { name: 'listNotes', method: 'GET', read: true, schemaKnown: true, fields: [] },
]

const at = (line: string, surface: 'prompt' | 'command' = 'prompt'): string[] =>
    completeCliLine({ line, commands: COMMANDS, surface }).candidates

describe('the first word', () => {
    test('an empty line offers every rpc and every reserved name', () => {
        const candidates = at('')
        expect(candidates).toContain('createNote')
        expect(candidates).toContain('listNotes')
        expect(candidates).toContain('serve')
        expect(candidates).toContain('help')
    })

    test('a partial narrows to its prefix', () => {
        expect(at('create')).toEqual(['createNote', 'createUser'])
    })

    test('exit/quit are offered at the PROMPT and withheld on a command line', () => {
        // They end a session, so they mean nothing to `app exit` — where the name falls through to
        // the rpc table. Offering them there would advertise something that does not happen.
        expect(at('exi', 'prompt')).toEqual(['exit'])
        expect(at('exi', 'command')).toEqual([])
    })
})

describe('flags', () => {
    test('a command with a trailing space offers its schema flags', () => {
        const candidates = at('createNote ')
        expect(candidates).toContain('--title')
        expect(candidates).toContain('--colour')
    })

    test('--args is never volunteered', () => {
        // It is on EVERY command, so it sorted first and became the default suggestion for every bare
        // `--` — the one flag you are never reaching for while typing flags. It still works spelled
        // out, and `help` still documents it.
        expect(at('createNote ')).not.toContain('--args')
        expect(at('createNote --')).not.toContain('--args')
        expect(at('createNote --a')).not.toContain('--args')
    })

    test('a boolean field offers BOTH spellings the parser accepts', () => {
        const candidates = at('createNote --p')
        expect(candidates).toEqual(['--pinned'])
        expect(at('createNote --no-')).toEqual(['--no-pinned'])
    })

    test('a flag already used is not offered again', () => {
        expect(at('createNote --title x ')).not.toContain('--title')
    })

    test('…except an array field, which is legal repeated', () => {
        // `--tag a --tag b` appends; suppressing it after the first would contradict the parser.
        expect(at('createNote --tag a ')).toContain('--tag')
    })

    test('a command whose schema declares no fields offers nothing', () => {
        expect(at('createUser ')).toEqual([])
    })
})

describe('values', () => {
    test('an enum field completes its closed set', () => {
        expect(at('createNote --colour ')).toEqual(['blue', 'green', 'red'])
        expect(at('createNote --colour g')).toEqual(['green'])
    })

    test('a non-enum field offers nothing — it wants a value', () => {
        // Offering flags here would suggest the value is optional when the parser reads the next
        // token as one.
        expect(at('createNote --title ')).toEqual([])
    })

    test('a boolean is a presence flag, so the next word really is another flag', () => {
        expect(at('createNote --pinned ')).toContain('--title')
    })
})

describe('reserved commands', () => {
    test('help completes a command name', () => {
        expect(at('help create')).toEqual(['createNote', 'createUser'])
    })

    test('serve and login offer their own flags', () => {
        expect(at('serve ')).toEqual(['--port'])
        expect(at('login ')).toEqual(['--token'])
    })

    test('connect takes a url, which nothing can enumerate', () => {
        expect(at('connect ')).toEqual([])
    })
})

describe('the partial handed back', () => {
    test('is the word being replaced, not the whole line', () => {
        // readline substitutes this; returning the whole line would eat the command name.
        expect(
            completeCliLine({ line: 'createNote --ti', commands: COMMANDS, surface: 'prompt' }),
        ).toEqual({ candidates: ['--title'], partial: '--ti' })
    })

    test('is empty when a new word is starting', () => {
        expect(
            completeCliLine({ line: 'createNote ', commands: COMMANDS, surface: 'prompt' }).partial,
        ).toBe('')
    })
})

describe('the signature hint', () => {
    const hintFor = (line: string): string | undefined =>
        completeCliLine({ line, commands: COMMANDS, surface: 'prompt' }).hint

    test('names every flag WITH its type once the command is typed', () => {
        // A bare list of flag names does not say what they take, which is exactly what you are stuck
        // on at this point.
        expect(hintFor('createNote ')).toBe(
            '--title <string> --author <string=anon> --pinned --tag <array> --colour <red|green|blue>',
        )
    })

    test('a boolean carries no placeholder — it takes no value', () => {
        expect(hintFor('createNote ')).toContain('--pinned ')
        expect(hintFor('createNote ')).not.toContain('--pinned <boolean>')
    })

    test('an enum shows its closed set, not the word string', () => {
        expect(hintFor('createNote ')).toContain('--colour <red|green|blue>')
    })

    test('a flag already given drops out of the hint', () => {
        expect(hintFor('createNote --title x ')).not.toContain('--title')
        expect(hintFor('createNote --title x ')).toContain('--pinned')
    })

    test('there is no hint once a word is being typed — that is a completion', () => {
        expect(hintFor('createNote --ti')).toBeUndefined()
    })

    test('a command with no declared fields has no signature to show', () => {
        expect(hintFor('createUser ')).toBeUndefined()
    })
})

describe('defaults in the signature', () => {
    const hintFor = (line: string): string | undefined =>
        completeCliLine({ line, commands: COMMANDS, surface: 'prompt' }).hint

    test('a default rides INSIDE the placeholder, so a multi-flag signature stays one line', () => {
        expect(hintFor('createNote ')).toContain('--author <string=anon>')
    })

    test('a flag with no default shows a bare placeholder', () => {
        expect(hintFor('createNote ')).toContain('--title <string>')
    })
})
