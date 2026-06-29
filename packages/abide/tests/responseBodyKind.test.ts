import { describe, expect, test } from 'bun:test'
import { contentBodyKind } from '../src/lib/shared/contentBodyKind.ts'
import { contentTypeOf } from '../src/lib/shared/contentTypeOf.ts'
import { isStreamingResponse } from '../src/lib/shared/isStreamingResponse.ts'
import { responseBodyKind } from '../src/lib/shared/responseBodyKind.ts'

/* The compressible regex the pre-S2 gzipResponse re-derived inline — reproduced
   here as the oracle so a parity drift in the classifier is caught. */
const COMPRESSIBLE_TYPE =
    /^(?:text\/|application\/(?:json|javascript|xml|[\w.-]+\+(?:json|xml))|image\/svg)/

function responseWith(contentType: string | undefined): Response {
    const headers = contentType === undefined ? undefined : { 'Content-Type': contentType }
    return new Response('x', { headers })
}

describe('responseBodyKind — single S2 classification', () => {
    test('streaming bucket matches isStreamingResponse for every content type', () => {
        for (const contentType of [
            'text/event-stream',
            'text/event-stream; charset=utf-8',
            'application/jsonl',
            'application/x-ndjson',
            'text/html; charset=utf-8',
            'application/json',
            'image/png',
            '',
        ]) {
            const response = responseWith(contentType || undefined)
            const isStreaming = responseBodyKind(response) === 'streaming'
            expect(isStreaming).toBe(isStreamingResponse(response))
        }
    })

    test('compressible bucket matches the old inline regex over the non-streaming types', () => {
        for (const contentType of [
            'text/html; charset=utf-8',
            'text/css',
            'application/json',
            'application/javascript',
            'application/xml',
            'application/atom+xml',
            'application/ld+json',
            'image/svg+xml',
            'image/png',
            'font/woff2',
            'application/octet-stream',
        ]) {
            const response = responseWith(contentType)
            const lowered = contentTypeOf(response.headers)
            /* The oracle: not-streaming AND matches the compressible regex. */
            const expected =
                contentBodyKind(lowered) !== 'streaming' && COMPRESSIBLE_TYPE.test(lowered)
            expect(responseBodyKind(response) === 'compressible').toBe(expected)
        }
    })

    test('binary/unknown is opaque', () => {
        expect(responseBodyKind(responseWith('image/png'))).toBe('opaque')
        expect(responseBodyKind(responseWith('application/octet-stream'))).toBe('opaque')
        expect(responseBodyKind(responseWith(undefined))).toBe('opaque')
    })

    test('streamed SSR HTML (text/html) classifies compressible, not streaming', () => {
        expect(responseBodyKind(responseWith('text/html; charset=utf-8'))).toBe('compressible')
    })
})
