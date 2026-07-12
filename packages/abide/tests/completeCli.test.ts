import { describe, expect, test } from 'bun:test'
import { completeCli } from '../src/lib/cli/completeCli.ts'
import { renderCliCompletions } from '../src/lib/cli/renderCliCompletions.ts'
import type { CliManifest } from '../src/lib/cli/types/CliManifest.ts'

/*
completeCli derives tab candidates from the baked manifest alone, so completion
can't drift from dispatch: the command position lists commands + connection
verbs, a chosen command lists its flags (with `--no-` for booleans), and an
unknown command lists nothing.
*/
const manifest: CliManifest = {
    getReport: {
        method: 'GET',
        url: '/rpc/getReport',
        jsonSchema: {
            properties: {
                title: { type: 'string' },
                verbose: { type: 'boolean' },
            },
        },
    },
    createUser: { method: 'POST', url: '/rpc/createUser' },
}

describe('completeCli', () => {
    test('completes the command position with commands + connection verbs', () => {
        const candidates = completeCli(manifest, 1, undefined)
        expect(candidates).toContain('getReport')
        expect(candidates).toContain('createUser')
        expect(candidates).toContain('/connect')
        expect(candidates).toContain('/completions')
        // Commands sort ahead of the connection verbs.
        expect(candidates.indexOf('createUser')).toBeLessThan(candidates.indexOf('/connect'))
    })

    test('completes a command with its flags, negating booleans', () => {
        const candidates = completeCli(manifest, 2, 'getReport')
        expect(candidates).toEqual(['--json', '--title', '--verbose', '--no-verbose'])
    })

    test('a command with no schema still offers --json', () => {
        expect(completeCli(manifest, 2, 'createUser')).toEqual(['--json'])
    })

    test('an unknown command offers nothing', () => {
        expect(completeCli(manifest, 2, 'nope')).toEqual([])
    })
})

describe('renderCliCompletions', () => {
    test('emits a wrapper per shell with the program name substituted', () => {
        for (const shell of ['bash', 'zsh', 'fish']) {
            const script = renderCliCompletions('myapp', shell)
            expect(script).toBeString()
            expect(script).toContain('myapp')
            expect(script).toContain('/completions --query')
            // The program-name sentinel must be fully substituted.
            expect(script).not.toContain('\0')
        }
    })

    test('returns undefined for an unknown or missing shell', () => {
        expect(renderCliCompletions('myapp', 'powershell')).toBeUndefined()
        expect(renderCliCompletions('myapp', undefined)).toBeUndefined()
    })
})
