import { AbideCompileError } from './AbideCompileError.ts'
import { asyncValuePositionError } from './asyncValuePositionError.ts'
import { asyncValuePositionInterpolations } from './asyncValuePositionInterpolations.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import type { TextPart } from './types/TextPart.ts'

/* A synthetic stream cell an `asyncIterable` interpolation lowers to: a unique local name
   and the raw interpolation expression it seeds. `analyzeComponent` prepends `const <name> =
   computed(<code>)` to the component script so the expression lowers through the normal signal
   pipeline (its author-signal reads become reactive reads) and desugars to an eager
   `trackedComputed` stream cell; the interpolation itself is rewritten to a bare `{name}`. */
export type InjectedCell = { name: string; code: string }

/* The result of the type-directed interpolation lowering: the transformed template plus the
   stream cells the `asyncIterable` interpolations were rewritten into (empty when none). */
export type LoweredInterpolations = { nodes: TemplateNode[]; cells: InjectedCell[] }

/*
Type-directed lowering of text-position interpolations (ADR-0019, Stages C+D). Walks the
parsed template and, per `{expr}` part, rewrites it by the classifier's verdict:

  - `promise`      → a synthesized STREAMING `await` node — the same TemplateNode shape the
                     explicit `{#await expr}{:then v}{v}{/await}` block parses to, so it flows
                     through the existing `awaitPlan`/`generateStreamingAwait` unchanged.
  - `asyncIterable`→ a stream CELL: the part is replaced by a bare `{__cN}` reference and a
                     `{ name, code }` cell is recorded, so it renders its latest frame live
                     (exactly as if the author had written `const __cN = computed(expr)` and
                     interpolated `{__cN}` — see `analyzeComponent`'s cell injection).
  - `sync`         → left as-is (a plain value bind).

Splitting mirrors the parser's `{await}` handling: an await block can only stand where element
content stands, so a promise part splits its surrounding text run — the parts before it stay
one text node, the await node stands between, the parts after become another text node. An
asyncIterable part needs no split: it stays an expression part in place (just renamed to its
cell), so it never breaks its text run. Called only when a classifier is available; without one
the template is returned untouched (no cells), preserving today's plain-value binding.
*/
export function lowerAsyncInterpolations(
    nodes: TemplateNode[],
    classify: InterpolationClassifier,
): LoweredInterpolations {
    /* Stage E guard (ADR-0019): a promise/asyncIterable can only render over time in CONTENT
       position (lowered below). In a NON-content value position — an attribute, an `{#if}` /
       `{#switch}` head, or a sync `{#each}` iterable — it would silently stringify to `[object
       Promise]` or fail to iterate, so classify each such interpolation and reject one that is
       async (a `{#for await}` iterable excepted — its `AsyncIterable` is the sanctioned form).
       Runs only with a classifier, so the default (no-classifier) path is unaffected. */
    for (const interpolation of asyncValuePositionInterpolations(nodes)) {
        const kind = classify(interpolation.loc, interpolation.code)
        const message = asyncValuePositionError(kind, interpolation.position)
        if (message !== undefined) {
            throw new AbideCompileError(message, interpolation.loc)
        }
    }
    /* Per-call counters so nested and sibling lowerings never collide on a name: `__v${n}`
       for the promise `then` binding, `__c${n}` for the asyncIterable stream cell. */
    const counters = { await: 0, cell: 0 }
    const cells: InjectedCell[] = []
    const loweredNodes = lowerList(nodes, classify, counters, cells)
    return { nodes: loweredNodes, cells }
}

/* Lowers a sibling list, splitting any text node that carries a promise interpolation and
   renaming any asyncIterable interpolation to its stream cell. */
function lowerList(
    nodes: TemplateNode[],
    classify: InterpolationClassifier,
    counters: { await: number; cell: number },
    cells: InjectedCell[],
): TemplateNode[] {
    const result: TemplateNode[] = []
    for (const node of nodes) {
        if (node.kind === 'text') {
            appendLoweredText(node.parts, classify, counters, cells, result)
            continue
        }
        if ('children' in node) {
            node.children = lowerList(node.children, classify, counters, cells)
        }
        result.push(node)
    }
    return result
}

/* Splits a text node's parts around each promise interpolation (pushing the surrounding runs
   as text nodes and the promise parts as streaming await nodes), and rewrites each
   asyncIterable interpolation in place to a bare reference to its recorded stream cell. */
function appendLoweredText(
    parts: TextPart[],
    classify: InterpolationClassifier,
    counters: { await: number; cell: number },
    cells: InjectedCell[],
    out: TemplateNode[],
): void {
    let run: TextPart[] = []
    for (const part of parts) {
        if (part.kind === 'expression' && part.loc !== undefined) {
            const kind = classify(part.loc, part.code)
            if (kind === 'promise') {
                if (run.length > 0) {
                    out.push({ kind: 'text', parts: run })
                    run = []
                }
                out.push(streamingAwaitNode(part.code, part.loc, counters.await++))
                continue
            }
            if (kind === 'asyncIterable') {
                /* Record a stream cell for the expression and rename the interpolation to it —
                   `analyzeComponent` injects `const __cN = computed(<code>)` so the cell exists,
                   and this bare `{__cN}` reference lowers to `$$readCell(__cN)` (latest frame). */
                const name = `__c${counters.cell++}`
                cells.push({ name, code: part.code })
                run.push({ kind: 'expression', code: name })
                continue
            }
        }
        run.push(part)
    }
    if (run.length > 0) {
        out.push({ kind: 'text', parts: run })
    }
}

/* Synthesizes the streaming `await` node for a promise interpolation: no inline
   `then` binding on the head (`blocking:false`), an explicit `then` branch binding
   a fresh `__v${n}` and rendering it as the branch's sole text child. */
function streamingAwaitNode(code: string, loc: number, index: number): TemplateNode {
    const binding = `__v${index}`
    return {
        kind: 'await',
        promise: code,
        blocking: false,
        as: undefined,
        children: [
            {
                kind: 'branch',
                branch: 'then',
                as: binding,
                children: [{ kind: 'text', parts: [{ kind: 'expression', code: binding }] }],
            },
        ],
        loc,
        asLoc: undefined,
    }
}
