import { afterEach, beforeEach, expect, test } from 'bun:test'
import { abideLog } from '../src/lib/shared/abideLog.ts'

/*
A thrown `Bun.build` failure is an AggregateError whose own message is only a
summary ("Bundle failed") — every real per-file diagnostic lives in `.errors`.
The logger used to reduce any Error to `.message`, so a build failure surfaced
with zero detail and the culprit `.abide` had to be hunted file by file. It must
now expand each sub-error, naming its source position.
*/

let captured: string[]
const originalError = console.error

beforeEach(() => {
    captured = []
    console.error = (...args: unknown[]) => {
        captured.push(args.map((arg) => String(arg)).join(' '))
    }
})

afterEach(() => {
    console.error = originalError
})

test('abideLog.error expands an AggregateError, naming each sub-error position', () => {
    // Shaped like Bun's BuildMessage: a message plus a source position.
    const buildMessage = (message: string, file: string, line: number, column: number) => ({
        message,
        position: { file, line, column },
    })
    const aggregate = new AggregateError(
        [
            buildMessage(
                '"await" can only be used inside an "async" function',
                'components/Button.abide',
                1,
                40,
            ),
            buildMessage('Expected "=>" but found ";"', 'components/Button.abide', 1, 51),
        ],
        'Bundle failed',
    )

    abideLog.error(aggregate)

    const output = captured.join('\n')
    expect(output).toContain('Bundle failed')
    expect(output).toContain('components/Button.abide:1:40')
    expect(output).toContain('"await" can only be used inside an "async" function')
    expect(output).toContain('components/Button.abide:1:51')
})

test('abideLog.error still renders a plain Error via its stack/message', () => {
    abideLog.error(new Error('a plain failure'))
    expect(captured.join('\n')).toContain('a plain failure')
})
