// The `abide <command>` banner.
//
// Everything asserted here is invisible to a type check and to every other test in the suite, because
// the banner's whole output is a string nothing parses: the escapes go to a stream the test harness
// is not, the layout is only wrong to an eye, and a note that lies (the port hop) reads exactly like
// one that does not. So the things that actually break are pinned — styling a pipe, the hop note
// appearing when nothing hopped, and the block opening by restating the command line above it.

import { afterEach, describe, expect, test } from 'bun:test'
import { banner, formatDuration, serveBanner } from './banner.ts'

// The ANSI CSI introducer, spelled rather than pasted: a literal escape BYTE in source is invisible
// in every editor and does not survive a copy-paste. Matching it IS the test here.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape is the subject.
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

describe('banner', () => {
    test('a pipe gets no ANSI escapes and no marker glyph', () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        // `bun test` writes to a pipe, so this is the ambient case rather than a simulated one.
        const text = banner([{ label: 'local', value: 'http://localhost:3000' }], ['ready in 40ms'])
        expect(text).not.toMatch(ESCAPE)
        expect(text).not.toContain('➜')
        // …and the content is all still there. An uncoloured banner is what a bug report pastes.
        expect(text).toContain('local')
        expect(text).toContain('http://localhost:3000')
        expect(text).toContain('ready in 40ms')
    })

    test('FORCE_COLOR styles it, and NO_COLOR wins over FORCE_COLOR', () => {
        Bun.env.FORCE_COLOR = '1'
        expect(banner([{ label: 'local', value: 'x' }], [])).toMatch(ESCAPE)

        Bun.env.NO_COLOR = '1'
        // The conventional precedence: a refusal beats an insistence.
        expect(banner([{ label: 'local', value: 'x' }], [])).not.toMatch(ESCAPE)
    })

    test('rows align on the longest label', () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        const rows = banner(
            [
                { label: 'local', value: 'A' },
                { label: 'network', value: 'B' },
            ],
            [],
        )
            .split('\n')
            .filter((line) => line.includes('A') || line.includes('B'))
        expect(rows).toHaveLength(2)
        expect(rows[0]?.indexOf('A')).toBe(rows[1]?.indexOf('B'))
    })

    test('no heading unless one is asked for — the shell already printed the command', () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        // The default block opens on the addresses. A header here would spend the most prominent
        // line restating the `$ abide dev` echo directly above it.
        const bare = banner([{ label: 'local', value: 'http://localhost:3000' }], [])
        expect(bare).not.toContain('abide dev')
        expect(bare.split('\n').filter((line) => line.length > 0)).toHaveLength(1)

        // …and the one case that earns it: `abide scaffold` boots a dev server, so that block is not
        // for the command the caller typed.
        expect(banner([{ label: 'local', value: 'x' }], [], 'abide dev')).toContain('abide dev')
    })

    test('an empty section contributes no blank line', () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        // `abide check` has notes and no rows; a naive layout prints the gap for the rows anyway and
        // the banner grows a hole where the addresses would have been.
        expect(banner([], ['no type errors'])).not.toContain('\n\n')
        expect(banner([{ label: 'output', value: 'x' }], [])).not.toContain('\n\n')
    })
})

describe('serveBanner', () => {
    test('says the requested port was taken only when it actually was', () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        const hopped = serveBanner({
            url: 'http://localhost:3001',
            requestedPort: 3000,
            elapsedMilliseconds: 412,
        })
        expect(hopped).toContain('port 3000 was taken')

        // The same number bound is the ordinary case, and a note that fires on it would be a lie
        // printed at every single boot — which is how a banner stops being read at all.
        const bound = serveBanner({
            url: 'http://localhost:3000',
            requestedPort: 3000,
            elapsedMilliseconds: 412,
        })
        expect(bound).not.toContain('was taken')
    })

    test('the local row carries the bound url verbatim', () => {
        delete Bun.env.NO_COLOR
        delete Bun.env.FORCE_COLOR
        const text = serveBanner({
            url: 'http://localhost:3001',
            elapsedMilliseconds: 8,
            notes: ['watching src/'],
        })
        expect(text).toContain('http://localhost:3001')
        expect(text).toContain('ready in 8ms')
        expect(text).toContain('watching src/')
        expect(text).toContain('ctrl-c stops')
    })
})

describe('formatDuration', () => {
    test('milliseconds under a second, one decimal of seconds over it', () => {
        expect(formatDuration(0)).toBe('0ms')
        expect(formatDuration(411.6)).toBe('412ms')
        expect(formatDuration(999)).toBe('999ms')
        expect(formatDuration(1000)).toBe('1.0s')
        expect(formatDuration(16_280)).toBe('16.3s')
    })
})
