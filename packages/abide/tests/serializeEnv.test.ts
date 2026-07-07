import { expect, test } from 'bun:test'
import { parseEnv } from '../src/lib/shared/parseEnv.ts'
import { serializeEnv } from '../src/lib/shared/serializeEnv.ts'

test('writes one KEY=value line per entry', () => {
    expect(serializeEnv({ PORT: '8080', NAME: 'chill' })).toBe('PORT=8080\nNAME=chill\n')
})

test('quotes values with whitespace, a #, or that are empty', () => {
    const text = serializeEnv({ ROOT: '/Users/me/My Media', NOTE: 'a # b', BLANK: '' })
    expect(text).toBe('ROOT="/Users/me/My Media"\nNOTE="a # b"\nBLANK=""\n')
})

test('round-trips through parseEnv unchanged', () => {
    const values = {
        HOST_ROOT: '/Users/me/Media Library',
        API_KEY: 'sk-12345',
        FLAG: 'true',
        BLANK: '',
    }
    expect(parseEnv(serializeEnv(values))).toEqual(values)
})

test('round-trips values that are themselves quote-wrapped (M15)', () => {
    // '"quoted"' used to emit bare and lose its literal quotes on the way back.
    const values = { A: '"quoted"', B: "'single'", C: 'has"inner', D: 'back\\slash' }
    expect(parseEnv(serializeEnv(values))).toEqual(values)
})

test('an embedded newline cannot inject a new KEY=value line (M19)', () => {
    const token = 'abc"\nABIDE_APP_URL=http://evil.example\ndef'
    const text = serializeEnv({ ABIDE_APP_URL: 'http://localhost:3000', TOKEN: token })
    // The malicious value must NOT appear as a bare, well-formed override line.
    expect(text).not.toContain('\nABIDE_APP_URL=http://evil.example\n')
    const parsed = parseEnv(text)
    expect(parsed.ABIDE_APP_URL).toBe('http://localhost:3000')
    expect(parsed.TOKEN).toBe(token)
})

test('parses CRLF-terminated .env (H9)', () => {
    expect(parseEnv('FOO=bar\r\nBAZ=qux\r\n')).toEqual({ FOO: 'bar', BAZ: 'qux' })
})
