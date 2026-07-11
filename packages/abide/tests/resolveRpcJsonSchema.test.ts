import { describe, expect, test } from 'bun:test'
import {
    resolveInputJsonSchema,
    resolveOutputJsonSchema,
} from '../src/lib/server/rpc/resolveRpcJsonSchema.ts'
import type { RpcRegistryEntry } from '../src/lib/server/rpc/types/RpcRegistryEntry.ts'

/* A minimal registry entry — the resolver reads only the four schema fields. */
function entry(fields: Partial<RpcRegistryEntry>): RpcRegistryEntry {
    return fields as RpcRegistryEntry
}

/* A validator whose library exposes a JSON-Schema projection (Zod/Effect shape). */
const validator = (schema: Record<string, unknown>) =>
    ({ toJSONSchema: () => schema }) as unknown as RpcRegistryEntry['inputSchema']

describe('resolveRpcJsonSchema — one resolution shared by MCP/OpenAPI/inspector/CLI', () => {
    test('a declared validator overrides the build-projected schema', () => {
        const e = entry({
            inputSchema: validator({ type: 'object', properties: { a: { type: 'string' } } }),
            inputJsonSchema: { type: 'object', properties: { ignored: { type: 'number' } } },
        })
        expect(resolveInputJsonSchema(e)).toEqual({
            type: 'object',
            properties: { a: { type: 'string' } },
        })
    })

    test('REGRESSION: a plainly-typed handler resolves to its projected inputJsonSchema, not the opaque fallback', () => {
        // The CLI manifest emitter once read only `inputSchema` here, so a handler with a
        // build-projected `inputJsonSchema` (and no validator) baked the opaque object —
        // breaking typed flags / array flags / --help while MCP/OpenAPI showed the real shape.
        const projected = { type: 'object', properties: { tags: { type: 'array' } } }
        const e = entry({ inputSchema: undefined, inputJsonSchema: projected })
        expect(resolveInputJsonSchema(e)).toBe(projected)
    })

    test('neither declared nor projected → undefined (callers apply their own fallback)', () => {
        expect(resolveInputJsonSchema(entry({}))).toBeUndefined()
        expect(resolveOutputJsonSchema(entry({}))).toBeUndefined()
    })

    test('output side follows the same rule', () => {
        expect(
            resolveOutputJsonSchema(
                entry({
                    outputSchema: validator({ type: 'number' }) as RpcRegistryEntry['outputSchema'],
                }),
            ),
        ).toEqual({ type: 'number' })
        const projected = { type: 'string' }
        expect(resolveOutputJsonSchema(entry({ outputJsonSchema: projected }))).toBe(projected)
    })
})
