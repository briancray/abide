// The flag dialect of a compiled binary's subcommands (MS3.2). The claim under test is that THE SCHEMA IS
// THE PARSER: `--n 5` on an integer field arrives as 5, not "5", and a field the schema does not
// declare is rejected — unless the binary carries no schema for that command at all, in which case
// flags pass through JSON-first and the server's validation is the arbiter.

import { describe, expect, test } from 'bun:test'
import type { CliCommand } from './cliCommands.ts'
import { parseCliArgs } from './parseCliArgs.ts'

function command(overrides: Partial<CliCommand> = {}): CliCommand {
    return {
        name: 'demo',
        method: 'POST',
        read: false,
        schemaKnown: true,
        fields: [
            { name: 'name', type: 'string', required: true },
            { name: 'count', type: 'integer', required: false },
            { name: 'loud', type: 'boolean', required: false },
            { name: 'tags', type: 'array', required: false },
        ],
        ...overrides,
    }
}

describe('parseCliArgs — schema-typed flags', () => {
    test('coerces each flag to its declared type', () => {
        const parsed = parseCliArgs(command(), ['--name', 'abide', '--count', '5'])
        expect(parsed.errors).toEqual([])
        expect(parsed.args).toEqual({ name: 'abide', count: 5 })
    })

    test('--flag=value is the same as --flag value', () => {
        const parsed = parseCliArgs(command(), ['--name=abide', '--count=2'])
        expect(parsed.errors).toEqual([])
        expect(parsed.args).toEqual({ name: 'abide', count: 2 })
    })

    test('a boolean field is a presence flag, and --no-<field> is its negative', () => {
        expect(parseCliArgs(command(), ['--name', 'x', '--loud']).args).toEqual({
            name: 'x',
            loud: true,
        })
        expect(parseCliArgs(command(), ['--name', 'x', '--no-loud']).args).toEqual({
            name: 'x',
            loud: false,
        })
        expect(parseCliArgs(command(), ['--name', 'x', '--loud', 'false']).args).toEqual({
            name: 'x',
            loud: false,
        })
    })

    test('an array field takes one JSON list or a repeated flag', () => {
        expect(parseCliArgs(command(), ['--name', 'x', '--tags', '["a","b"]']).args).toEqual({
            name: 'x',
            tags: ['a', 'b'],
        })
        expect(parseCliArgs(command(), ['--name', 'x', '--tags', 'a', '--tags', 'b']).args).toEqual(
            {
                name: 'x',
                tags: ['a', 'b'],
            },
        )
    })

    test('--args carries the whole object, and flags on either side override its fields', () => {
        const parsed = parseCliArgs(command(), [
            '--args',
            '{"name":"from-json","count":1}',
            '--count',
            '9',
        ])
        expect(parsed.errors).toEqual([])
        expect(parsed.args).toEqual({ name: 'from-json', count: 9 })
    })

    test('collects every problem in one pass rather than stopping at the first', () => {
        const parsed = parseCliArgs(command(), ['--count', 'lots', '--nope', '1', 'stray'])
        expect(parsed.errors).toHaveLength(4)
        expect(parsed.errors.join('\n')).toContain('--count expects integer')
        expect(parsed.errors.join('\n')).toContain('unknown flag --nope')
        expect(parsed.errors.join('\n')).toContain('unexpected argument "stray"')
        expect(parsed.errors.join('\n')).toContain('demo requires --name')
    })

    test('with no baked schema every flag is accepted, JSON-first', () => {
        const parsed = parseCliArgs(command({ schemaKnown: false, fields: [] }), [
            '--anything',
            '5',
            '--who',
            'abide',
            '--on',
            'true',
        ])
        expect(parsed.errors).toEqual([])
        // `5` is a number and `true` a boolean because they parse as JSON; `abide` does not, so it
        // stays the literal string rather than becoming a parse error.
        expect(parsed.args).toEqual({ anything: 5, who: 'abide', on: true })
    })
})
