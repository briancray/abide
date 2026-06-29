import { describe, expect, test } from 'bun:test'
import { changeAffectsClient } from '../src/lib/shared/changeAffectsClient.ts'

describe('changeAffectsClient', () => {
    /* Server/MCP-only changes: the dev loop can restart the SSR worker without
       re-bundling the client. */
    test.each([
        'server/rpc/users.ts',
        'server/rpc/nested/deep.ts',
        'server/sockets/chat.ts',
        'mcp/prompts/review.md',
        'mcp/resources/data.json',
        'server/config.ts',
    ])('server/mcp-only path does not affect the client: %s', (path) => {
        expect(changeAffectsClient(path)).toBe(false)
    })

    /* Client-affecting changes: must pay the full client rebuild. */
    test.each([
        'ui/Card.abide',
        'ui/pages/page.abide',
        'ui/app.css',
        'shared/util.ts',
        'app.ts',
        'counterState.ts',
        // Other server files (not rpc/sockets/config) feed SSR-rendered output.
        'server/middleware.ts',
        // A file literally named like config but outside server/ is not the config virtual.
        'config.ts',
        'server/configHelpers.ts',
    ])('client-affecting path forces a full rebuild: %s', (path) => {
        expect(changeAffectsClient(path)).toBe(true)
    })

    /* Windows separators normalise to the same classification. */
    test('windows-style separators are normalised', () => {
        expect(changeAffectsClient('server\\rpc\\users.ts')).toBe(false)
        expect(changeAffectsClient('ui\\Card.abide')).toBe(true)
    })

    /* Conservative default: an unrecognised top-level path rebuilds the client. */
    test('unknown paths default to client-affecting', () => {
        expect(changeAffectsClient('something-new/file.ts')).toBe(true)
    })
})
