import { describe, expect, test } from 'bun:test'
import { routeParamsShape } from '../src/lib/shared/routeParamsShape.ts'

describe('routeParamsShape', () => {
    test('a param-less route has no params', () => {
        expect(routeParamsShape('/about')).toBe('Record<string, never>')
    })

    test('[name] and [...rest] params type as string', () => {
        expect(routeParamsShape('/media/[id]/[...rest]')).toBe('{ "id": string; "rest": string }')
    })

    test('an [[optional]] param types as an optional key', () => {
        expect(routeParamsShape('/[[lang]]/docs/[page]')).toBe(
            '{ "lang"?: string; "page": string }',
        )
    })
})
