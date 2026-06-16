import { describe, expect, test } from 'bun:test'
import { createTraceContext } from '../src/lib/shared/createTraceContext.ts'
import { formatTraceparent } from '../src/lib/shared/formatTraceparent.ts'
import { parseTraceparent } from '../src/lib/shared/parseTraceparent.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'
const HEADER = `00-${TRACE_ID}-${SPAN_ID}-01`

describe('parseTraceparent', () => {
    test('parses a valid header into its parts', () => {
        expect(parseTraceparent(HEADER)).toEqual({
            traceId: TRACE_ID,
            spanId: SPAN_ID,
            flags: '01',
        })
    })

    test('normalises case and surrounding whitespace', () => {
        expect(parseTraceparent(`  ${HEADER.toUpperCase()}  `)?.traceId).toBe(TRACE_ID)
    })

    test('rejects malformed values, zero ids, and the reserved ff version', () => {
        expect(parseTraceparent('nonsense')).toBeUndefined()
        expect(parseTraceparent(`00-${'0'.repeat(32)}-${SPAN_ID}-01`)).toBeUndefined()
        expect(parseTraceparent(`00-${TRACE_ID}-${'0'.repeat(16)}-01`)).toBeUndefined()
        expect(parseTraceparent(`ff-${TRACE_ID}-${SPAN_ID}-01`)).toBeUndefined()
    })
})

describe('createTraceContext', () => {
    test('continues an inbound trace: id and flags kept, caller span preserved as parent', () => {
        const context = createTraceContext(HEADER)
        expect(context.traceId).toBe(TRACE_ID)
        expect(context.flags).toBe('01')
        expect(context.parentSpanId).toBe(SPAN_ID)
        // A fresh step id is minted — never the caller's.
        expect(context.spanId).toMatch(/^[0-9a-f]{16}$/)
        expect(context.spanId).not.toBe(SPAN_ID)
    })

    test('starts a sampled trace when the header is absent or malformed', () => {
        for (const header of [undefined, null, 'garbage']) {
            const context = createTraceContext(header)
            expect(context.traceId).toMatch(/^[0-9a-f]{32}$/)
            expect(context.spanId).toMatch(/^[0-9a-f]{16}$/)
            expect(context.parentSpanId).toBeUndefined()
            expect(context.flags).toBe('01')
        }
    })

    test('round-trips through formatTraceparent', () => {
        const context = createTraceContext(HEADER)
        expect(formatTraceparent(context)).toBe(`00-${TRACE_ID}-${context.spanId}-01`)
        // The reformatted header parses back to the same position.
        expect(parseTraceparent(formatTraceparent(context))?.spanId).toBe(context.spanId)
    })
})
