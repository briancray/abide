import { expect, test } from 'bun:test'
import { props } from '../src/lib/ui/props.ts'

test('props() throws when called at runtime — it is compiler-lowered in .abide', () => {
    expect(() => props()).toThrow(/compiler-lowered/)
})
