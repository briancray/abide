import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GET } from '../GET.ts'
import { handleMcp } from './mcp.ts'
import { buildRegistry } from './registry.ts'
import { reaches, rpcsFor } from './surfaceProjection.ts'

// A SURFACE is a projection of the registry for one kind of caller, and `clients` is the one gate over
// all of them. The gate used to be re-decided at nine sites in six modules; these pin the two properties
// that made that a defect rather than a duplication.

const CONFIG = {
    routes: {
        everywhere: GET(() => ({ ok: true })),
        noMcp: GET(() => ({ ok: true }), { clients: { mcp: false } }),
        noBrowser: GET(() => ({ ok: true }), { clients: { browser: false } }),
        nowhere: GET(() => ({ ok: true }), { clients: false }),
    },
} as never

describe('the clients gate is one predicate', () => {
    test('absent means reachable — the default is ON, which is what a negation gets wrong', () => {
        // `!entry.clients[surface]` reads like the same question and is wrong for every callable that
        // never mentioned `clients`, which is most of them.
        expect(reaches({ clients: {} }, 'mcp')).toBe(true)
        expect(reaches({ clients: { mcp: true } }, 'mcp')).toBe(true)
        expect(reaches({ clients: { mcp: false } }, 'mcp')).toBe(false)
        // Withholding one surface leaves the others reachable.
        expect(reaches({ clients: { mcp: false } }, 'cli')).toBe(true)
    })

    test('each surface sees its own set', () => {
        const registry = buildRegistry(CONFIG)
        expect(rpcsFor(registry, 'mcp').map((entry) => entry.name)).toEqual([
            'everywhere',
            'noBrowser',
        ])
        expect(rpcsFor(registry, 'browser').map((entry) => entry.name)).toEqual([
            'everywhere',
            'noMcp',
        ])
        // `clients: false` withholds all three (ADR 0027 D9) — it is absent from every surface.
        expect(rpcsFor(registry, 'cli').map((entry) => entry.name)).toEqual([
            'everywhere',
            'noMcp',
            'noBrowser',
        ])
    })

    // THE DRIFT THIS PREVENTS. `mcp.ts` spelled the predicate four times, and two of those pairs have to
    // agree or the surface lies: the tool LIST and the tool DISPATCH must admit the same set. A drifted
    // pair advertises a tool that answers "unknown tool", or leaves one reachable that was never
    // advertised — and nothing tied the two loops together. Both now call `rpcsFor(registry, 'mcp')`.
    test('the MCP tool list is exactly the set MCP dispatch admits', async () => {
        // Through the ROUTE, not a private projection helper: the list is only worth comparing in the
        // form a caller actually receives.
        const response = await handleMcp(
            new Request('http://localhost/__abide/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
            }),
            CONFIG,
        )
        const body = (await response.json()) as { result: { tools: Array<{ name: string }> } }
        const advertised = body.result.tools
            .map((tool) => tool.name)
            .filter((name) => !name.endsWith('_tail') && !name.endsWith('_publish'))
        const dispatchable = rpcsFor(buildRegistry(CONFIG), 'mcp').map((entry) => entry.name)
        expect(advertised.sort()).toEqual(dispatchable.sort())
        expect(advertised).not.toContain('noMcp')
        expect(advertised).not.toContain('nowhere')

        // AND THE OTHER HALF, which is the half that actually catches drift. Comparing the list against
        // `rpcsFor` only proves the LIST calls the helper; a dispatch loop that walks `registry.rpcs`
        // raw would still answer a withheld tool, and the first draft of this test passed with exactly
        // that regression applied. So call one.
        const refused = await handleMcp(
            new Request('http://localhost/__abide/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/call',
                    params: { name: 'noMcp', arguments: {} },
                }),
            }),
            CONFIG,
        )
        const refusal = (await refused.json()) as { error?: { message: string } }
        expect(refusal.error?.message).toContain('Unknown tool')
    })

    // The gate having an owner is only worth something if nothing re-decides it in a corner. This is the
    // check that would have caught the original nine.
    test('no module re-decides the gate inline', () => {
        const dir = import.meta.dir
        const offenders: string[] = []
        for (const name of readdirSync(dir)) {
            if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
            // `registry.ts` OWNS the flags and names the spelling in prose; `surfaceProjection.ts` is
            // where the one real comparison lives.
            if (name === 'registry.ts' || name === 'surfaceProjection.ts') continue
            const source = readFileSync(join(dir, name), 'utf8')
            for (const match of source.matchAll(/clients\.(browser|mcp|cli)\s*===\s*false/g)) {
                offenders.push(`${name}: ${match[0]}`)
            }
        }
        expect(offenders).toEqual([])
    })
})
