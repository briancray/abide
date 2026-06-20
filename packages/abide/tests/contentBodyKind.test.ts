import { describe, expect, test } from 'bun:test'
import { contentBodyKind } from '../src/lib/shared/contentBodyKind.ts'

describe('contentBodyKind', () => {
    test('streaming types win over the json substring match', () => {
        // jsonl / ndjson contain "json" — the streaming-first order must catch them.
        expect(contentBodyKind('application/jsonl')).toBe('streaming')
        expect(contentBodyKind('application/x-ndjson')).toBe('streaming')
        expect(contentBodyKind('text/event-stream')).toBe('streaming')
    })

    test('json by substring (covers +json suffixes)', () => {
        expect(contentBodyKind('application/json')).toBe('json')
        expect(contentBodyKind('application/json; charset=utf-8')).toBe('json')
        expect(contentBodyKind('application/hal+json')).toBe('json')
    })

    test('text by prefix', () => {
        expect(contentBodyKind('text/plain')).toBe('text')
        expect(contentBodyKind('text/html; charset=utf-8')).toBe('text')
    })

    test('everything else is binary', () => {
        expect(contentBodyKind('application/octet-stream')).toBe('binary')
        expect(contentBodyKind('application/xml')).toBe('binary')
        expect(contentBodyKind('image/png')).toBe('binary')
        expect(contentBodyKind('')).toBe('binary')
    })
})
