import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AbideCompileError } from '../src/lib/ui/compile/AbideCompileError.ts'
import { classifyInterpolationType } from '../src/lib/ui/compile/classifyInterpolationType.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'
import { nodeAtShadowOffset } from '../src/lib/ui/compile/nodeAtShadowOffset.ts'
import { shadowNaming } from '../src/lib/ui/compile/shadowNaming.ts'
import { sourceToShadowOffset } from '../src/lib/ui/compile/sourceToShadowOffset.ts'
import type { InterpolationClassifier } from '../src/lib/ui/compile/types/InterpolationClassifier.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

/* Builds a shadow-backed classifier over a component source written to a throwaway on-disk
   project — the same wiring the promise suite sets up inline, factored so each async-iterable
   fixture (with its own component text) can spin up a classifier that resolves against it. */
function makeClassifier(source: string): InterpolationClassifier {
    const dir = mkdtempSync(join(tmpdir(), 'abide-typedir-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                module: 'esnext',
                moduleResolution: 'bundler',
                target: 'esnext',
                lib: ['esnext', 'dom'],
            },
        }),
    )
    const abidePath = join(dir, 'Component.abide')
    writeFileSync(abidePath, source)
    const { program, shadows } = createShadowProgram(dir, [abidePath])
    const checker = program.getTypeChecker()
    const shadow = shadows.get(abidePath)!
    const shadowFile = program.getSourceFile(shadowNaming.suffixed(abidePath))!
    return (loc, code) => {
        const offset = sourceToShadowOffset(shadow.mappings, loc)
        if (offset === undefined) {
            return 'sync'
        }
        const node = nodeAtShadowOffset(shadowFile, offset, code.length)
        if (node === undefined) {
            return 'sync'
        }
        return classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
    }
}

/* A throwaway project on disk — createShadowProgram reads sources via ts.sys, so the
   component and its tsconfig must live as real files for the checker to run. */
const SOURCE = `<script>
async function getPromise(): Promise<string> { return 'x' }
const count: number = 5
</script>
<p>{getPromise()}</p>
<span>{count}</span>
`

describe('type-directed interpolation lowering', () => {
    const dir = mkdtempSync(join(tmpdir(), 'abide-typedir-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                module: 'esnext',
                moduleResolution: 'bundler',
                target: 'esnext',
                lib: ['esnext', 'dom'],
            },
        }),
    )
    const abidePath = join(dir, 'Component.abide')
    writeFileSync(abidePath, SOURCE)

    /* A shadow-backed classifier over the fixture, built the way the spike /
       classifyInterpolationType.test do: map the interpolation's source offset into
       shadow coordinates, find its expression node, classify its checker type. */
    const { program, shadows } = createShadowProgram(dir, [abidePath])
    const checker = program.getTypeChecker()
    const shadow = shadows.get(abidePath)!
    const shadowFile = program.getSourceFile(shadowNaming.suffixed(abidePath))!
    const classify: InterpolationClassifier = (loc, code) => {
        const offset = sourceToShadowOffset(shadow.mappings, loc)
        if (offset === undefined) {
            return 'sync'
        }
        const node = nodeAtShadowOffset(shadowFile, offset, code.length)
        if (node === undefined) {
            return 'sync'
        }
        return classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
    }

    test('a promise interpolation lowers to a streaming peek-cell (client)', () => {
        const lowered = compileComponent(SOURCE, false, undefined, undefined, classify)
        /* ADR-0032 D5: a promise content interpolation is now a STREAMING peek-cell (`, true`),
           not a synthetic streaming await — read at the position via `$$readCell`. */
        expect(lowered).toContain(
            '$$scope().trackedComputed(async () => await (getPromise()), true)',
        )
        expect(lowered).toContain('$$readCell(__v0)')
        expect(lowered).not.toContain('$$awaitBlock(')
    })

    test('a promise interpolation lowers to a streaming peek-cell (SSR)', () => {
        const lowered = compileSSR(SOURCE, false, undefined, undefined, classify)
        /* The peek-cell is injected on the SSR path too; the value renders through `$$readCell`,
           not the old streaming-await `$awaits` registration. */
        expect(lowered).toContain(
            '$$scope().trackedComputed(async () => await (getPromise()), true)',
        )
        expect(lowered).toContain('$$readCell(__v0)')
        expect(lowered).not.toContain('$awaits.push(')
        expect(lowered).not.toContain('$$awaitBlock(')
    })

    test('a sync interpolation is unchanged by the classifier', () => {
        const lowered = compileComponent(SOURCE, false, undefined, undefined, classify)
        /* The promise became a peek-cell (not an await block): zero await blocks, exactly one
           injected cell. */
        expect(lowered).not.toContain('$$awaitBlock(')
        expect(lowered.match(/trackedComputed\(/g)?.length).toBe(1)
        /* `{count}` still binds as a plain text value — the sync bind is untouched. */
        expect(lowered).toMatch(/return \(count\)/)
    })

    test('without a classifier the promise interpolation stays a plain text bind', () => {
        const plain = compileComponent(SOURCE)
        expect(plain).not.toContain('$$awaitBlock(')
        /* Today's default path: the promise binds through the plain text helper. */
        expect(plain).toContain('getPromise()')
        expect(plain).toMatch(/\$\$appendText\([^;]*getPromise/)
    })
})

/* ADR-0032: an asyncIterable-typed text interpolation `{getStream()}` lifts to a stream cell —
   a synthetic `const __vN = computed(getStream())` injected into the script (desugared to an
   eager `trackedComputed`, latest frame — NO streaming/blocking arg, byte-identical to an
   explicit `state.computed`) with the interpolation rewritten to `{__vN}` (read via `$$readCell`).
   The injected name is now the unified `__vN` (the old asyncIterable-only `__cN` is gone). */
describe('type-directed interpolation lowering — async iterable → stream cell', () => {
    const STREAM = `<script>
function getStream(): AsyncIterable<string> { return (async function* () { yield 'x' })() }
</script>
<p>{getStream()}</p>
`
    /* The authored equivalent: an explicit bare-call `state.computed(getStream())` seed + a
       `{__v0}` reference — the form the cell injection must produce byte-for-byte. The
       `state` import desugars away (fully consumed), so the emitted body carries none. */
    /* The injected cell is APPENDED (after the author's decls), so the equivalent authored form
       puts `const __v0` after the function too — matching how a signal-arg stream would seed from
       initialized state rather than a pre-init undefined. */
    const STREAM_EXPLICIT = `<script>
import { state } from '@abide/abide/ui/state'
function getStream(): AsyncIterable<string> { return (async function* () { yield 'x' })() }
const __v0 = state.computed(getStream())
</script>
<p>{__v0}</p>
`

    test('a stream interpolation lowers to a trackedComputed cell read (client)', () => {
        const classify = makeClassifier(STREAM)
        const lowered = compileComponent(STREAM, false, undefined, undefined, classify)
        /* The injected cell desugars to the eager stream-classifying computed… */
        expect(lowered).toContain('$$scope().trackedComputed(')
        /* …and the interpolation reads it through the unified cell read. */
        expect(lowered).toContain('$$readCell(')
        /* NOT a bare text bind of the raw async-iterable call. */
        expect(lowered).not.toMatch(/\$\$appendText\([^;]*getStream/)
    })

    test('the lowered stream form equals the explicit state.computed form (client + SSR)', () => {
        const classify = makeClassifier(STREAM)
        const loweredClient = compileComponent(STREAM, false, undefined, undefined, classify)
        const explicitClient = compileComponent(STREAM_EXPLICIT)
        /* Byte-for-byte: the synthetic name is `__v0` in both, and the asyncIterable seed carries
           no streaming/blocking arg — identical to an explicit `state.computed`. */
        expect(loweredClient).toBe(explicitClient)
        const loweredSsr = compileSSR(STREAM, false, undefined, undefined, classify)
        const explicitSsr = compileSSR(STREAM_EXPLICIT)
        expect(loweredSsr).toBe(explicitSsr)
    })

    test('a nameless async-generator return type still lowers to a stream cell', () => {
        /* No named type — the return is an inline `AsyncGenerator`, proving the classify path
           is structural (Symbol.asyncIterator), not gated on a named `AsyncIterable`. */
        const source = `<script>
async function* gen() { yield 'a' }
</script>
<p>{gen()}</p>
`
        const classify = makeClassifier(source)
        const lowered = compileComponent(source, false, undefined, undefined, classify)
        expect(lowered).toContain('$$scope().trackedComputed(() => gen())')
        expect(lowered).toContain('$$readCell(')
        expect(lowered).not.toMatch(/\$\$appendText\([^;]*gen\(\)/)
    })

    test('an expression with a signal arg lowers that signal inside the cell thunk', () => {
        const source = `<script>
import { state } from '@abide/abide/ui/state'
let count = state(0)
function getStream(n: number): AsyncIterable<string> { return (async function* () { yield String(n) })() }
</script>
<p>{getStream(count)}</p>
`
        const classify = makeClassifier(source)
        const lowered = compileComponent(source, false, undefined, undefined, classify)
        /* The injected cell's `count` argument lowers to its reactive doc read, inside the
           trackedComputed thunk — proving the expression's author signals lower normally. */
        expect(lowered).toContain(
            '$$scope().trackedComputed(() => getStream($$model.read("count")))',
        )
        expect(lowered).toContain('$$readCell(')
    })

    test('regression: promise streams as a peek-cell, sync stays plain, and no classifier is today’s behavior', () => {
        /* A component mixing a promise, a stream, and a sync interpolation. */
        const source = `<script>
async function getPromise(): Promise<string> { return 'p' }
function getStream(): AsyncIterable<string> { return (async function* () { yield 's' })() }
const count: number = 5
</script>
<p>{getPromise()}</p>
<p>{getStream()}</p>
<span>{count}</span>
`
        const classify = makeClassifier(source)
        const lowered = compileComponent(source, false, undefined, undefined, classify)
        /* ADR-0032: the promise lifts to a STREAMING peek-cell (`, true`) — no await block. */
        expect(lowered).toContain(
            '$$scope().trackedComputed(async () => await (getPromise()), true)',
        )
        expect(lowered).toContain('$$readCell(')
        expect(lowered).not.toContain('$$awaitBlock(')
        /* The stream lifts to a bare (no-arg) trackedComputed cell. */
        expect(lowered).toContain('$$scope().trackedComputed(() => getStream())')
        /* The sync `{count}` stays a plain text bind — neither an await nor a cell. */
        expect(lowered).toMatch(/\$\$appendText\([^;]*count/)
        /* Without a classifier, no cell is injected (today's plain text bind). */
        const plain = compileComponent(source)
        expect(plain).not.toContain('trackedComputed')
        expect(plain).toMatch(/\$\$appendText\([^;]*getStream/)
    })
})

/* ADR-0032: a promise/asyncIterable in EVERY position (attribute, `{#if}`/`{#switch}` head,
   plain `{#for}` source) now LIFTS to a peek-cell — the old value-position rejection is retired.
   The ONE remaining error is a raw `AsyncIterable` in a PLAIN `{#for}` source (D4a): a frame is
   not a collection. The lift only fires with a classifier; `{#for await}` is exempt (unchanged). */
describe('type-directed interpolation lowering — async value-position lift (ADR-0032)', () => {
    const PROMISE_DECL = `async function getPromise(): Promise<string> { return 'x' }`
    const STREAM_DECL = `function getStream(): AsyncIterable<string> { return (async function* () { yield 'x' })() }`

    /* Compiles a source under a classifier resolved against that same source. */
    const compileClassified = (source: string): string => {
        const classify = makeClassifier(source)
        return compileComponent(source, false, undefined, undefined, classify)
    }

    test('a promise in an attribute value lifts to a peek-cell', () => {
        const source = `<script>\n${PROMISE_DECL}\n</script>\n<div class={getPromise()}></div>\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain(
            '$$scope().trackedComputed(async () => await (getPromise()), true)',
        )
        expect(lowered).toContain('$$readCell(__v0)')
    })

    test('a promise in an {#if} head lifts to a peek-cell, pending-aware (renders no branch)', () => {
        const source = `<script>\nasync function getPromise(): Promise<boolean> { return true }\n</script>\n{#if getPromise()}<p>yes</p>{/if}\n`
        const lowered = compileClassified(source)
        /* A bare async subject reads its value through the peek AND passes `when` a pending probe
           so a still-loading cell renders neither branch (not the falsy `{:else}`). */
        expect(lowered).toContain('$$when(host, () => $$readCell(__v0),')
        expect(lowered).toContain('() => $$cellPending(__v0))')
        expect(lowered).toContain(
            '$$scope().trackedComputed(async () => await (getPromise()), true)',
        )
    })

    test('a bare async {#if} head guards its SSR render behind the pending probe', () => {
        const source = `<script>\nasync function getPromise(): Promise<boolean> { return true }\n</script>\n{#if getPromise()}<p>yes</p>{:else}<p>no</p>{/if}\n`
        const classify = makeClassifier(source)
        const ssr = compileSSR(source, false, undefined, undefined, classify)
        /* SSR skips BOTH branches while the cell is pending (mirrors the client `when`): an empty
           `$$cellPending` guard clause holds the chain, and the `$$readCell` clause picks then/else
           once it settles — so a streaming subject's `{:else}` never bakes into the shell early. */
        expect(ssr).toContain('if ($$cellPending(__v0)) {')
        expect(ssr).toContain('else if ($$readCell(__v0)) {')
    })

    test('a mixed cond-chain interleaves sync and async branch clauses in SSR', () => {
        const source = `<script>\nasync function getPromise(): Promise<boolean> { return true }\n</script>\n{#if false}<p>a</p>{:else if getPromise()}<p>b</p>{:else}<p>c</p>{/if}\n`
        const classify = makeClassifier(source)
        const ssr = compileSSR(source, false, undefined, undefined, classify)
        /* The sync branch stays a plain clause; the async {:else if} expands to a pending-guard
           clause (empty — holds) followed by its value clause, then the default {:else}. */
        expect(ssr).toContain('if (false) {')
        expect(ssr).toContain('else if ($$cellPending(__v0)) {')
        expect(ssr).toContain('else if ($$readCell(__v0)) {')
        expect(ssr).toMatch(/else \{[\s\S]*"c"/)
    })

    /* The "pending halts the cond-chain" rule is implemented INDEPENDENTLY on each side — SSR emits
       an empty `$$cellPending` guard clause that stops the `if/else-if` chain, the client emits a
       per-case `pending` probe that `switchBlock.select` reads to hold the chain (return -1). They
       must stay in lockstep or a still-pending client and the settled server pick DIFFERENT branches
       → hydration divergence. This co-located test pins BOTH from one fixture, so dropping the gate
       on either side fails here (not just in a same-side test elsewhere in this file). */
    test('an async cond-chain gates on pending on BOTH client and SSR (kept in lockstep)', () => {
        const source = `<script>\nasync function getPromise(): Promise<boolean> { return true }\n</script>\n{#if false}<p>a</p>{:else if getPromise()}<p>b</p>{:else}<p>c</p>{/if}\n`
        const classify = makeClassifier(source)
        const client = compileComponent(source, false, undefined, undefined, classify)
        const ssr = compileSSR(source, false, undefined, undefined, classify)
        /* Client: the async case carries a pending probe the select loop consults. */
        expect(client).toContain('pending: () => $$cellPending(__v0)')
        /* SSR: the matching empty guard clause halts the else-if chain while pending. */
        expect(ssr).toContain('else if ($$cellPending(__v0)) {')
    })

    test('a promise in a {#switch} head lifts to a peek-cell, pending-aware (matches no case)', () => {
        const source = `<script>\nasync function getPromise(): Promise<string> { return 'a' }\n</script>\n{#switch getPromise()}{:case 'a'}<p>a</p>{/switch}\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('$$switchBlock(host, () => $$readCell(__v0),')
        expect(lowered).toContain('() => $$cellPending(__v0))')
        expect(lowered).toContain(
            '$$scope().trackedComputed(async () => await (getPromise()), true)',
        )
    })

    test('a promise (of an iterable) as a plain {#for} source lifts to a peek-cell', () => {
        const source = `<script>\nasync function getPromise(): Promise<string[]> { return [] }\n</script>\n{#for x of getPromise()}<p>{x}</p>{/for}\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('$$each(host, () => ($$readCell(__v0))')
        expect(lowered).toContain(
            '$$scope().trackedComputed(async () => await (getPromise()), true)',
        )
    })

    test('an AsyncIterable as a plain {#each} iterable throws (needs {#for await}) — D4a', () => {
        const source = `<script>\n${STREAM_DECL}\n</script>\n{#for x of getStream()}<p>{x}</p>{/for}\n`
        expect(() => compileClassified(source)).toThrow(AbideCompileError)
    })

    test('a promise in TEXT position lifts to a streaming peek-cell', () => {
        const source = `<script>\n${PROMISE_DECL}\n</script>\n<p>{getPromise()}</p>\n`
        const lowered = compileClassified(source)
        /* Position-scoped: the text interpolation is now a peek-cell, not a streaming await. */
        expect(lowered).toContain('$$readCell(__v0)')
        expect(lowered).not.toContain('$$awaitBlock(')
    })

    test('not errored: an AsyncIterable in {#for await} (the sanctioned async position) compiles', () => {
        const source = `<script>\n${STREAM_DECL}\n</script>\n{#for await x of getStream()}<p>{x}</p>{/for}\n`
        expect(() => compileClassified(source)).not.toThrow()
    })

    test('without a classifier none of the guarded positions throw (default path unchanged)', () => {
        const attr = `<script>\n${PROMISE_DECL}\n</script>\n<div class={getPromise()}></div>\n`
        const ifHead = `<script>\nasync function getPromise(): Promise<boolean> { return true }\n</script>\n{#if getPromise()}<p>yes</p>{/if}\n`
        const eachStream = `<script>\n${STREAM_DECL}\n</script>\n{#for x of getStream()}<p>{x}</p>{/for}\n`
        expect(() => compileComponent(attr)).not.toThrow()
        expect(() => compileComponent(ifHead)).not.toThrow()
        expect(() => compileComponent(eachStream)).not.toThrow()
    })
})

/* ADR-0032 D1/D2: the walk lifts the async OPERAND (not the whole interpolation), so `??`/`?.`/
   member access compose around the peek; a leading `await` selects the BLOCKING SSR tier. */
describe('ADR-0032 async sub-expression lift — composition & tiers', () => {
    const compileClassified = (source: string): string => {
        const classify = makeClassifier(source)
        return compileComponent(source, false, undefined, undefined, classify)
    }

    test('`??` lifts only the async operand — the fallback survives around the peek', () => {
        const source = `<script>\nasync function getFoo(): Promise<string> { return 'x' }\n</script>\n<p>{getFoo() ?? 'Loading...'}</p>\n`
        const lowered = compileClassified(source)
        /* Only `getFoo()` lifted; the `?? 'Loading...'` fallback stays in the text bind. */
        expect(lowered).toContain("$$readCell(__v0) ?? 'Loading...'")
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (getFoo()), true)')
    })

    test('`?.` composes on the peek — the member access survives', () => {
        const source = `<script>\nasync function getFoo(): Promise<{ name: string }> { return { name: 'x' } }\n</script>\n<p>{getFoo()?.name}</p>\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('$$readCell(__v0)?.name')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (getFoo()), true)')
    })

    test('a template literal keeps its shape, the inner call lifts', () => {
        const source = `<script>\nasync function getFoo(): Promise<string> { return 'x' }\n</script>\n<p>{\`\${getFoo()}\`}</p>\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('`${$$readCell(__v0)}`')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (getFoo()), true)')
    })

    test('a ternary whose branches are async lifts WHOLE as one streaming cell (rule 3)', () => {
        const source = `<script>\nasync function getA(): Promise<string> { return 'a' }\nasync function getB(): Promise<string> { return 'b' }\nconst cond = true\n</script>\n<p>{cond ? getA() : getB()}</p>\n`
        const lowered = compileClassified(source)
        /* One injected cell whose seed carries the whole ternary; the position reads it. */
        expect(lowered.match(/trackedComputed\(/g)?.length).toBe(1)
        expect(lowered).toContain('cond ? getA() : getB()')
        expect(lowered).toContain('$$readCell(__v0)')
        /* Streaming tier — no leading `await` on the interpolation. */
        expect(lowered).toContain(', true)')
    })

    test('an interpolated attribute part lifts its async operand', () => {
        const source = `<script>\nasync function getFoo(): Promise<string> { return 'x' }\n</script>\n<a title="a {getFoo()} b">x</a>\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('$$readCell(__v0)')
        expect(lowered).toContain('attr_title')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (getFoo()), true)')
    })

    test('an attribute value promise lifts (href={getFoo()})', () => {
        const source = `<script>\nasync function getFoo(): Promise<string> { return 'x' }\n</script>\n<a href={getFoo()}>x</a>\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('$$attr(el1, "href"')
        expect(lowered).toContain('$$readCell(__v0)')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (getFoo()), true)')
    })

    test('a leading `await` selects the BLOCKING tier in an {#if} head (`, false`)', () => {
        const source = `<script>\nasync function ready(): Promise<boolean> { return true }\n</script>\n{#if await ready()}<p>ok</p>{/if}\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (ready()), false)')
        expect(lowered).toContain('$$when(host, () => $$readCell(__v0),')
    })

    test('a leading `await` selects the BLOCKING tier in an attribute (`, false`)', () => {
        const source = `<script>\nasync function url(): Promise<string> { return 'x' }\n</script>\n<img src={await url()} />\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (url()), false)')
        expect(lowered).toContain('$$attr(el1, "src"')
        // a blocking cell in an attribute reads through the SUSPENDING read (ADR-0042)
        expect(lowered).toContain('$$readCell(__v0)')
    })

    test('the no-`await` forms stay STREAMING (`, true`)', () => {
        const source = `<script>\nasync function ready(): Promise<boolean> { return true }\n</script>\n{#if ready()}<p>ok</p>{/if}\n`
        const lowered = compileClassified(source)
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (ready()), true)')
    })

    test('D4b: a leading `await` on an AsyncIterable throws AbideCompileError', () => {
        const source = `<script>\nfunction getStream(): AsyncIterable<boolean> { return (async function* () { yield true })() }\n</script>\n{#if await getStream()}<p>ok</p>{/if}\n`
        expect(() => compileClassified(source)).toThrow(AbideCompileError)
    })
})

/* A client mount proving the stream cell renders its latest frame live. */
describe('type-directed interpolation lowering — stream cell mount', () => {
    beforeAll(() => {
        installMiniDom()
    })

    test('{getStream()} renders the latest frame after settle', async () => {
        /* An async generator that yields two frames; after the microtask queue drains the
           cell holds — and the DOM shows — the LATEST frame. */
        /* No type annotations — the body runs through `new Function` (raw JS), and the classifier
           infers the AsyncGenerator return type from the yields via the shadow program. */
        const source = `<script>
async function* getStream() { yield 'first'; yield 'last' }
</script>
<p>{getStream()}</p>
`
        const classify = makeClassifier(source)
        const body = compileComponent(source, false, undefined, undefined, classify)
        const host = document.createElement('div')
        /* The compiled body references the runtime by its `$$`-prefixed globals (published by
           uiPreload); only `host` is a free binding to inject. */
        new Function('host', body)(host)
        await settle()
        expect(host.textContent).toContain('last')
    })
})

/* ADR-0032 regression (adversarial review, Finding 1): the walk must NOT hoist an async
   (sub)expression out of a nested function literal. Doing so would pull the callback's parameters
   out of scope (a free identifier → ReferenceError) and run the seed once instead of per row. */
describe('async sub-expression lift — nested function boundary (ADR-0032)', () => {
    test('a promise call inside a .map callback is NOT lifted (type-directed)', () => {
        const source = `<script>
async function fetchName(id: number): Promise<string> { return 'n' }
const ids: number[] = [1, 2]
</script>
<p>{ids.map((x) => fetchName(x))}</p>
`
        const lowered = compileComponent(
            source,
            false,
            undefined,
            undefined,
            makeClassifier(source),
        )
        /* No cell hoisted; the callback survives verbatim so `x` stays bound. */
        expect(lowered).not.toContain('trackedComputed')
        expect(lowered).toContain('fetchName(x)')
    })

    test('an await inside an async callback is NOT lifted (syntactic, no classifier)', () => {
        const source = `<script>
async function load(id: number): Promise<string> { return 'x' }
const ids: number[] = [1, 2]
</script>
<p>{ids.map(async (x) => await load(x))}</p>
`
        /* No classifier: only a TOP-LEVEL await lifts; this await is inside the callback's own scope. */
        const lowered = compileComponent(source)
        expect(lowered).not.toContain('trackedComputed')
        expect(lowered).toContain('load(x)')
    })
})
