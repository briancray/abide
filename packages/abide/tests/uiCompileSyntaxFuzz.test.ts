import { describe, expect, test } from 'bun:test'
import { lowerDocAccess } from '../src/lib/ui/compile/lowerDocAccess.ts'
import { renameSignalRefs } from '../src/lib/ui/compile/renameSignalRefs.ts'

/*
Syntax fuzz corpus for the identifier-rewriting passes. The enumeration of which
positions are value reads can never be proven complete by inspection (the grammar
is larger than working memory and grows), so this asserts the property that
actually matters: a rewrite pass NEVER emits invalid syntax. Each snippet is run
through a pass and the output is fed to Bun's transpiler — a misclassified slot
corrupts the output into unparseable code, which throws here and names the gap.
*/

/* Throws if `code` is not valid TS — the corruption detector. */
const transpiler = new Bun.Transpiler({ loader: 'ts' })
function assertValid(code: string, label: string): void {
    try {
        transpiler.transformSync(code)
    } catch (error) {
        throw new Error(`${label} produced invalid syntax:\n${code}\n\n${String(error)}`)
    }
}

const STATE = new Set(['sig'])
const NONE = new Set<string>()

describe('renameSignalRefs — name-slot snippets stay valid and unrewritten', () => {
    /* Each snippet places `sig` in a position that is NOT a value read; the pass must
       leave it as written and the output must parse. */
    const nameSlotCorpus: Record<string, string> = {
        'destructure source key': 'const { sig: renamed } = obj',
        'array destructure binding': 'const [sig] = list',
        'nested destructure key': 'const { a: { sig: x } } = obj',
        'statement label + labeled break': 'sig: for (const x of xs) { break sig }',
        'labeled continue': 'sig: for (const x of xs) { continue sig }',
        'object literal key': 'const o = { sig: 1 }',
        'class method name': 'class C { sig() { return 1 } }',
        'class getter name': 'class C { get sig() { return 1 } }',
        'class field name': 'class C { sig = 1 }',
        'function declaration name': 'function sig() { return 1 }',
        'enum member name': 'enum E { sig }',
        'import specifier alias original': "import { sig as s } from 'm'",
        'default import name': "import sig from 'm'",
        'namespace import name': "import * as sig from 'm'",
        'property access member': 'const v = obj.sig',
    }
    for (const [label, code] of Object.entries(nameSlotCorpus)) {
        test(label, () => {
            const out = renameSignalRefs(code, STATE, NONE)
            assertValid(out, label)
            expect(out).not.toContain('model.sig')
        })
    }
})

describe('renameSignalRefs — value-read snippets rewrite and stay valid', () => {
    /* `sig` is a genuine read here; the pass must rewrite to `model.sig` and stay valid. */
    const valueReadCorpus: Record<string, string> = {
        'plain read': 'console.log(sig)',
        'computed member key': 'const o = { [sig]: 1 }',
        'optional-chain read': 'foo(sig?.bar)',
        'satisfies operand': 'const v = (sig satisfies number)',
        'non-null read': 'const v = sig!',
        'template expression': 'const v = `x${sig}y`',
        'logical-assign target read': 'obj[sig] ??= 1',
    }
    for (const [label, code] of Object.entries(valueReadCorpus)) {
        test(label, () => {
            const out = renameSignalRefs(code, STATE, NONE)
            assertValid(out, label)
            expect(out).toContain('model.sig')
        })
    }
})

describe('lowerDocAccess — optional chaining and rich access stay valid', () => {
    /* The `?.`/`?.[`/`?.()` family folds into the path; assert no corruption. */
    const docCorpus: string[] = [
        'model.lines[0].sku',
        'model?.lines[0].sku',
        'model.lines?.[0].sku',
        'model.note?.length',
        'model.list?.push(v)',
        'model.byId[key]?.name',
        'const x = model.a ?? model.b',
        'model.count += 1',
    ]
    for (const code of docCorpus) {
        test(code, () => {
            const out = lowerDocAccess(code, 'model')
            assertValid(out, code)
        })
    }
})
