import { describe, expect, test } from 'bun:test'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'
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

describe('compileModule — whole components with tricky syntax stay valid', () => {
    /* End-to-end: corruption anywhere in the pipeline (desugar, lowerScript, the
       per-expression lowerOnce, the generators) shows up as an unparseable module. */
    const componentCorpus: Record<string, string> = {
        'aliased import colliding with a prop, used in template': `<script>import { pending as pendingProbe } from 'm'
const { query, pending = false } = props()
const busy = scope().computed(() => pending && pendingProbe(query))</script><i>{busy}</i>`,
        'optional chaining in an interpolation': `<script>const user = scope().state({})</script><i>{user?.name?.first}</i>`,
        'optional-chain items in an each': `<script>const data = scope().state({})</script><ul><template each={data?.rows ?? []} as="row" key="row"><li>{row.id}</li></template></ul>`,
        'destructure with colliding source key in a handler': `<script>const count = scope().state(0)
const onClick = () => { const { count: c } = window; count(c) }</script><button on:click={onClick}>x</button>`,
        'computed key referencing a signal': `<script>const k = scope().state('a')
const obj = scope().computed(() => ({ [k]: 1 }))</script><i>{obj[k]}</i>`,
        'nullish-coalescing in a binding': `<script>const name = scope().state('')</script><i>{name ?? 'anon'}</i>`,
    }
    for (const [label, source] of Object.entries(componentCorpus)) {
        test(label, () => {
            assertValid(compileModule(source, { isLayout: false }), label)
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
