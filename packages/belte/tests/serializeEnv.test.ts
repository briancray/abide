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
