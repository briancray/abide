import { describe, expect, test } from 'bun:test'
import { parseArgvForRpc } from '../src/lib/cli/parseArgvForRpc.ts'
import { tokenizeArgvFlags } from '../src/lib/cli/tokenizeArgvFlags.ts'

/*
The two consumers of tokenizeArgvFlags — parseArgvForRpc (RPC arg parsing) and
commandArgvRequestsHelp (help detection in runCli) — must apply the same
flag-consumption grammar so they can never disagree on whether a `--help`
landed at a flag position or as a value. commandArgvRequestsHelp is not
exported, so it is reconstructed here from the same tokenizer it consumes.
*/
const requestsHelp = (argvTail: string[], jsonSchema?: Record<string, unknown>): boolean => {
    for (const token of tokenizeArgvFlags(argvTail, jsonSchema)) {
        if (token.isHelp) {
            return true
        }
    }
    return false
}

const schema = {
    properties: {
        title: { type: 'string' },
        verbose: { type: 'boolean' },
        count: { type: 'number' },
        tags: { type: 'array' },
        nums: { type: 'array', items: { type: 'number' } },
    },
}

describe('tokenizeArgvFlags grammar', () => {
    test('--help / -h at a flag position is a help token', () => {
        expect([...tokenizeArgvFlags(['--help'], schema)]).toEqual([{ isHelp: true }])
        expect([...tokenizeArgvFlags(['-h'], schema)]).toEqual([{ isHelp: true }])
    })

    test('boolean prop consumes no following token', () => {
        expect([...tokenizeArgvFlags(['--verbose', '--help'], schema)]).toEqual([
            { name: 'verbose', negated: false },
            { isHelp: true },
        ])
    })

    test('--no-x negates a known boolean, keeps literal name otherwise', () => {
        expect([...tokenizeArgvFlags(['--no-verbose'], schema)]).toEqual([
            { name: 'verbose', negated: true },
        ])
        // `no-title` is not a boolean prop → literal name kept, consumes next token.
        expect([...tokenizeArgvFlags(['--no-title', 'x'], schema)]).toEqual([
            { name: 'no-title', value: 'x' },
        ])
    })

    test('value flag consumes the next token; inline = consumes none', () => {
        expect([...tokenizeArgvFlags(['--title', 'hi', '--help'], schema)]).toEqual([
            { name: 'title', value: 'hi' },
            { isHelp: true },
        ])
        expect([...tokenizeArgvFlags(['--title=hi', '--help'], schema)]).toEqual([
            { name: 'title', value: 'hi' },
            { isHelp: true },
        ])
    })

    test('--json consumes its blob as the value', () => {
        expect([...tokenizeArgvFlags(['--json', '{"a":1}'], schema)]).toEqual([
            { isJson: true, value: '{"a":1}' },
        ])
        expect([...tokenizeArgvFlags(['--json'], schema)]).toEqual([
            { isJson: true, missingValue: true },
        ])
    })

    test('missing value is flagged, not silently dropped', () => {
        expect([...tokenizeArgvFlags(['--title'], schema)]).toEqual([
            { name: 'title', missingValue: true },
        ])
    })

    test('positional surfaces for the consumer to handle', () => {
        expect([...tokenizeArgvFlags(['oops'], schema)]).toEqual([{ positional: 'oops' }])
    })
})

describe('both consumers agree on --help position (previously divergent)', () => {
    /*
    Each case asserts: help detection's verdict and whether the parser treats
    the same `--help` as a value vs. a stray flag are derived from one grammar.
    The parser is the source of truth for consumption (it is what runs), so help
    detection must match its token boundaries.
    */
    test('--help as a value flag value is NOT a help request', async () => {
        // title consumes `--help` as its value → not help, and parser stores it.
        expect(requestsHelp(['--title', '--help'], schema)).toBe(false)
        expect(await parseArgvForRpc(['--title', '--help'], schema)).toEqual({ title: '--help' })
    })

    test('--help after a boolean flag IS a help request (boolean consumes nothing)', async () => {
        expect(requestsHelp(['--verbose', '--help'], schema)).toBe(true)
        // Parser, seeing the same boundaries, hits --help as a stray flag and throws.
        expect(parseArgvForRpc(['--verbose', '--help'], schema)).rejects.toThrow(/--help/)
    })

    test('--help as the --json blob value is NOT a help request', async () => {
        expect(requestsHelp(['--json', '--help'], schema)).toBe(false)
        // Parser consumes `--help` as the (invalid JSON) blob → JSON.parse throws,
        // proving it consumed the same token rather than treating it as help.
        expect(parseArgvForRpc(['--json', '--help'], schema)).rejects.toThrow()
    })

    test('--help after inline =value IS a help request', () => {
        expect(requestsHelp(['--title=x', '--help'], schema)).toBe(true)
    })

    test('--help at first position is a help request', () => {
        expect(requestsHelp(['--help'], schema)).toBe(true)
        expect(requestsHelp(['-h'], schema)).toBe(true)
    })
})

describe('parseArgvForRpc value semantics preserved over the shared tokenizer', () => {
    test('boolean and --no- negation', async () => {
        expect(await parseArgvForRpc(['--verbose'], schema)).toEqual({ verbose: true })
        expect(await parseArgvForRpc(['--no-verbose'], schema)).toEqual({ verbose: false })
    })

    test('inline --flag=false on a boolean honours the RHS (not always true)', async () => {
        expect(await parseArgvForRpc(['--verbose=false'], schema)).toEqual({ verbose: false })
        expect(await parseArgvForRpc(['--verbose=true'], schema)).toEqual({ verbose: true })
        expect(await parseArgvForRpc(['--verbose=0'], schema)).toEqual({ verbose: false })
        expect(parseArgvForRpc(['--verbose=maybe'], schema)).rejects.toThrow(/true or false/)
    })

    test('array elements coerce per items.type', async () => {
        expect(await parseArgvForRpc(['--nums', '1', '--nums', '2'], schema)).toEqual({
            nums: [1, 2],
        })
        expect(parseArgvForRpc(['--nums', 'x'], schema)).rejects.toThrow(/expects a number/)
        // an untyped array stays string-valued
        expect(await parseArgvForRpc(['--tags', 'a', '--tags', 'b'], schema)).toEqual({
            tags: ['a', 'b'],
        })
    })

    test('number coercion and blank rejection', async () => {
        expect(await parseArgvForRpc(['--count', '3'], schema)).toEqual({ count: 3 })
        expect(parseArgvForRpc(['--count', '  '], schema)).rejects.toThrow(/expects a number/)
    })

    test('array accumulation across repeats', async () => {
        expect(await parseArgvForRpc(['--tags', 'a', '--tags', 'b'], schema)).toEqual({
            tags: ['a', 'b'],
        })
    })

    test('--json merges the whole bag; non-object rejected', async () => {
        expect(await parseArgvForRpc(['--json', '{"a":1,"b":"x"}'], schema)).toEqual({
            a: 1,
            b: 'x',
        })
        expect(parseArgvForRpc(['--json', '[1,2]'], schema)).rejects.toThrow(/JSON object/)
        expect(parseArgvForRpc(['--json'], schema)).rejects.toThrow(/--json requires a value/)
    })

    test('inline = value and string default', async () => {
        expect(await parseArgvForRpc(['--title=hello'], schema)).toEqual({ title: 'hello' })
        expect(await parseArgvForRpc(['--title', 'hello'], schema)).toEqual({ title: 'hello' })
    })

    test('positional and missing value throw', async () => {
        expect(parseArgvForRpc(['oops'], schema)).rejects.toThrow(/unexpected positional/)
        expect(parseArgvForRpc(['--title'], schema)).rejects.toThrow(/--title requires a value/)
    })

    test('empty argv yields undefined', async () => {
        expect(await parseArgvForRpc([], schema)).toBeUndefined()
    })
})
