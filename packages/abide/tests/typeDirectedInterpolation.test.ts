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

/* The same component with the promise interpolation written as an EXPLICIT streaming
   await — the shape type-directed lowering synthesizes. The classified compile of
   SOURCE must equal the plain compile of this. */
const EXPLICIT = `<script>
async function getPromise(): Promise<string> { return 'x' }
const count: number = 5
</script>
<p>{#await getPromise()}{:then __v0}{__v0}{/await}</p>
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

    test('a promise interpolation lowers to a streaming await (client)', () => {
        const lowered = compileComponent(SOURCE, false, undefined, undefined, classify)
        const explicit = compileComponent(EXPLICIT)
        /* The lowered promise interpolation is byte-for-byte the explicit streaming await. */
        expect(lowered).toBe(explicit)
        expect(lowered).toContain('$$awaitBlock(')
        /* NOT a bare text bind of the promise. */
        expect(lowered).not.toMatch(/\$\$appendText\([^;]*getPromise/)
    })

    test('a promise interpolation lowers to a streaming await (SSR)', () => {
        const lowered = compileSSR(SOURCE, false, undefined, undefined, classify)
        const explicit = compileSSR(EXPLICIT)
        expect(lowered).toBe(explicit)
        /* The streaming-await SSR emission registers on `$awaits` rather than pushing the
           promise as text (which would stringify to `[object Promise]` at runtime). */
        expect(lowered).toContain('$awaits.push(')
        expect(lowered).not.toMatch(/\$text\([^;]*getPromise/)
    })

    test('a sync interpolation is unchanged by the classifier', () => {
        const lowered = compileComponent(SOURCE, false, undefined, undefined, classify)
        /* Only the promise interpolation became an await — the sync `{count}` did not, so
           there is exactly one await block in the whole component. */
        expect(lowered.match(/\$\$awaitBlock\(/g)?.length).toBe(1)
        /* `{count}` still binds as a plain text value. */
        expect(lowered).toMatch(/\$\$appendText\([^;]*count/)
    })

    test('without a classifier the promise interpolation stays a plain text bind', () => {
        const plain = compileComponent(SOURCE)
        expect(plain).not.toContain('$$awaitBlock(')
        /* Today's default path: the promise binds through the plain text helper. */
        expect(plain).toContain('getPromise()')
        expect(plain).toMatch(/\$\$appendText\([^;]*getPromise/)
    })
})

/* Stage D: an asyncIterable-typed text interpolation `{getStream()}` lowers to a stream cell —
   a synthetic `const __cN = computed(getStream())` injected into the script (desugared to an
   eager `trackedComputed`, latest frame) with the interpolation rewritten to `{__cN}`
   (read via `$$readCell`). */
describe('type-directed interpolation lowering — async iterable → stream cell', () => {
    const STREAM = `<script>
function getStream(): AsyncIterable<string> { return (async function* () { yield 'x' })() }
</script>
<p>{getStream()}</p>
`
    /* The authored equivalent: an explicit bare-call `state.computed(getStream())` seed + a
       `{__c0}` reference — the form Stage D's cell injection must produce byte-for-byte. The
       `state` import desugars away (fully consumed), so the emitted body carries none. */
    /* The injected cell is APPENDED (after the author's decls), so the equivalent authored form
       puts `const __c0` after the function too — matching how a signal-arg stream would seed from
       initialized state rather than a pre-init undefined. */
    const STREAM_EXPLICIT = `<script>
import { state } from '@abide/abide/ui/state'
function getStream(): AsyncIterable<string> { return (async function* () { yield 'x' })() }
const __c0 = state.computed(getStream())
</script>
<p>{__c0}</p>
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
        /* Byte-for-byte: the synthetic name is `__c0` in both, so no normalization is needed. */
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

    test('regression: promise streams, sync stays plain, and no classifier is today’s behavior', () => {
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
        /* The promise still streams (Stage C await block). */
        expect(lowered).toContain('$$awaitBlock(')
        /* The stream still routes to a trackedComputed cell (Stage D). */
        expect(lowered).toContain('$$scope().trackedComputed(')
        /* The sync `{count}` stays a plain text bind — neither an await nor a cell. */
        expect(lowered).toMatch(/\$\$appendText\([^;]*count/)
        /* Without a classifier, the stream call is today's plain text bind (no cell). */
        const plain = compileComponent(source)
        expect(plain).not.toContain('trackedComputed')
        expect(plain).toMatch(/\$\$appendText\([^;]*getStream/)
    })
})

/* Stage E: a promise/asyncIterable in a NON-content VALUE position (an attribute, an `{#if}` /
   `{#switch}` head, a sync `{#each}` iterable) is a compile error — it can't render over time
   there and would silently stringify to `[object Promise]` or fail to iterate. The guard only
   fires with a classifier; the sanctioned `{#for await}` async iterable is exempt. */
describe('type-directed interpolation lowering — async value-position guard (Stage E)', () => {
    const PROMISE_DECL = `async function getPromise(): Promise<string> { return 'x' }`
    const STREAM_DECL = `function getStream(): AsyncIterable<string> { return (async function* () { yield 'x' })() }`

    /* Compiles a source under a classifier resolved against that same source. */
    const compileClassified = (source: string): string => {
        const classify = makeClassifier(source)
        return compileComponent(source, false, undefined, undefined, classify)
    }

    test('a promise in an attribute value throws', () => {
        const source = `<script>\n${PROMISE_DECL}\n</script>\n<div class={getPromise()}></div>\n`
        expect(() => compileClassified(source)).toThrow(AbideCompileError)
    })

    test('a promise in an {#if} head throws', () => {
        const source = `<script>\nasync function getPromise(): Promise<boolean> { return true }\n</script>\n{#if getPromise()}<p>yes</p>{/if}\n`
        expect(() => compileClassified(source)).toThrow(AbideCompileError)
    })

    test('a promise in a {#switch} head throws', () => {
        const source = `<script>\nasync function getPromise(): Promise<string> { return 'a' }\n</script>\n{#switch getPromise()}{:case 'a'}<p>a</p>{/switch}\n`
        expect(() => compileClassified(source)).toThrow(AbideCompileError)
    })

    test('a promise as a sync {#each} iterable throws (a promise is not iterable)', () => {
        const source = `<script>\nasync function getPromise(): Promise<string[]> { return [] }\n</script>\n{#for x of getPromise()}<p>{x}</p>{/for}\n`
        expect(() => compileClassified(source)).toThrow(AbideCompileError)
    })

    test('an AsyncIterable as a sync {#each} iterable throws (needs {#for await})', () => {
        const source = `<script>\n${STREAM_DECL}\n</script>\n{#for x of getStream()}<p>{x}</p>{/for}\n`
        expect(() => compileClassified(source)).toThrow(AbideCompileError)
    })

    test('not errored: a promise in TEXT position still lowers to a streaming await', () => {
        const source = `<script>\n${PROMISE_DECL}\n</script>\n<p>{getPromise()}</p>\n`
        const lowered = compileClassified(source)
        /* Position-scoped: the text interpolation streams (Stage C), it does not throw. */
        expect(lowered).toContain('$$awaitBlock(')
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
