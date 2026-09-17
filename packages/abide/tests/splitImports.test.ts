import { expect, test } from 'bun:test'
import { splitImports } from '#compiler/splitImports.ts'

test('imports hoist and a dynamic import stays', () => {
    const r = splitImports(
        "import { reactive } from 'abide'\nimport type { X } from './x.ts'\nconst a = 1\nconst m = import('./late.ts')\n",
    )
    expect(r.imports).toBe(
        "import { reactive } from 'abide'\nimport type { X } from './x.ts'\n",
    )
    expect(r.body.trim()).toBe("const a = 1\nconst m = import('./late.ts')")
})
test('a script with no imports is returned whole', () => {
    expect(splitImports('const a = 1').body).toBe('const a = 1')
})
test('an import inside a string is not one', () => {
    const r = splitImports('const s = "import x from \'y\'"\n')
    expect(r.imports).toBe('')
})
