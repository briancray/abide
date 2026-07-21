import { describe, expect, test } from 'bun:test'
import { resolveTemplateAlias } from './resolveTemplateAlias.ts'

describe('resolveTemplateAlias', () => {
    const from = '/app/src/ui/pages/reactivity'

    test('$ui resolves against the nearest src ancestor, regardless of depth', () => {
        expect(resolveTemplateAlias('$ui/components/Demo.abide', from)).toBe(
            '/app/src/ui/components/Demo.abide',
        )
        expect(
            resolveTemplateAlias('$ui/demos/reactivity/StateDemo.abide', '/app/src/ui/demos'),
        ).toBe('/app/src/ui/demos/reactivity/StateDemo.abide')
    })

    test('$server and $shared map to their src subdirs', () => {
        expect(resolveTemplateAlias('$server/rpc/hello', from)).toBe('/app/src/server/rpc/hello')
        expect(resolveTemplateAlias('$shared/fmt.ts', from)).toBe('/app/src/shared/fmt.ts')
    })

    test('non-alias specifiers return undefined (caller falls back to relative)', () => {
        expect(resolveTemplateAlias('./Sibling.abide', from)).toBeUndefined()
        expect(resolveTemplateAlias('../x/Y.abide', from)).toBeUndefined()
        expect(resolveTemplateAlias('abide/ui/state', from)).toBeUndefined()
        expect(resolveTemplateAlias('$unknown/x', from)).toBeUndefined()
        expect(resolveTemplateAlias('$ui', from)).toBeUndefined() // no subpath
    })

    test('undefined when the importer is not under a src/ tree', () => {
        expect(resolveTemplateAlias('$ui/components/Demo.abide', '/tmp/nowhere')).toBeUndefined()
    })

    test('picks the nearest src when the path nests one', () => {
        expect(resolveTemplateAlias('$ui/x.abide', '/a/src/ui/demos')).toBe('/a/src/ui/x.abide')
    })
})
