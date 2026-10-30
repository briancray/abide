// 20.19, 20.20 — A TOOL'S `inputSchema` IS AN OBJECT AT ITS TOP LEVEL, which is all MCP accepts: a
// client refusing one tool's refuses the whole `tools/list`, and the app reads as having none.

import { expect, test } from 'bun:test'

import type { Mounted } from '../src/server/answerRpc.ts'
import { McpSurface } from '../src/server/generatedSurfaces.ts'

const BY_MEDIA = {
    type: 'object',
    properties: { mediaId: { type: 'number' } },
    required: ['mediaId'],
}
const BY_FILES = {
    type: 'object',
    properties: { fileIds: { type: 'array', items: { type: 'number' } } },
    required: ['fileIds'],
}

function surfaceOver(args: unknown): McpSurface {
    const mounted = {
        address: '/match',
        method: 'POST',
        private: false,
        mcp: true,
        result: undefined,
        handler: { clients: {}, keyed: false, description: 'Match.' },
        argsDocument: args,
    } as unknown as Mounted
    return new McpSurface(
        new Map([['POST /match', mounted]]),
        async () => new Response(null),
    )
}

// THE REVERT: list `tool.schema ?? { type: 'object' }`; a union's `inputSchema` is a bare `anyOf`,
// its `type` undefined.
test('a union of objects is listed as an object, its anyOf kept — 20.19', () => {
    const [tool] = surfaceOver({ anyOf: [BY_MEDIA, BY_FILES] }).list()
    expect(tool?.inputSchema).toEqual({
        anyOf: [BY_MEDIA, BY_FILES],
        type: 'object',
    })
    const [none] = surfaceOver(undefined).list()
    expect(none?.inputSchema).toEqual({ type: 'object' })
    const [nullable] = surfaceOver({
        ...BY_MEDIA,
        type: ['object', 'null'],
    }).list()
    expect(nullable?.inputSchema).toHaveProperty('type', 'object')
})

// THE REVERT: drop the constructor's check; `surfaceOver` returns, and the tool is listed with a
// schema no call can satisfy.
test('args that can never be an object refuse the app, naming the tool — 20.20', () => {
    for (const args of [
        { type: 'string' },
        { anyOf: [{ type: 'string' }, { type: 'number' }] },
        { allOf: [BY_MEDIA, { type: 'array' }] },
    ]) {
        let thrown = ''
        try {
            surfaceOver(args)
        } catch (error) {
            thrown = (error as Error).message
        }
        expect(thrown).toContain('post_match')
        expect(thrown).toContain('RULEBOOK 20.20')
    }
})
