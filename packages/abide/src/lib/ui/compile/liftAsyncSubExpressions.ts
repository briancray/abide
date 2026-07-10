import ts from 'typescript'
import { AbideCompileError } from './AbideCompileError.ts'
import type { InjectedCell } from './lowerAsyncInterpolations.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'
import type { InterpolationKind } from './types/InterpolationKind.ts'

/* The value/content position a lifted (sub)expression sits in — only `each` (a plain `{#for}`
   source) forbids an `AsyncIterable` (D4a). Every other position renders a stream's latest frame. */
export type LiftPosition = 'content' | 'attribute' | 'if' | 'switch' | 'each'

/* A lifted (sub)expression's span within the interpolation `code` and how it lifts: `start`/`end`
   index `code`, `kind` picks the peek flavour, `blocking` marks a leading `await`. The runtime uses
   these to rewrite the span to a cell ref; the type-check shadow uses the non-blocking ones to wrap
   the seed in a peek helper so its resolved type composes (ADR-0032). */
export type LiftSpan = {
    start: number
    end: number
    kind: 'promise' | 'asyncIterable'
    blocking: boolean
}

/* The binary operators whose result reacts to a pending-`undefined` operand: the walk does NOT
   lift the composition, it descends into the operands so the operator composes the peek(s)
   (ADR-0032 D1). `?.` needs no entry — a member/call on a promise is sync-typed, so the default
   sync-recurse already reaches and lifts the async base. */
const PENDING_TOLERANT = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.AmpersandAmpersandToken,
])

/*
ADR-0032 — the sub-expression walk. Given an interpolation's verbatim `code`, its absolute source
offset `loc`, and the warm classifier, lifts every promise/`AsyncIterable`-typed (sub)expression
into an injected peek-cell and rewrites it in place to a bare `__vN` reference, returning the
rewritten code and the cells to inject. Pending is `undefined` at the value level, so `??` / `?.` /
member access compose around the peek (`getFoo() ?? 'Loading…'` shows the fallback while pending).

Three rules, top-down (ADR D1 "The walk"):
  1. `await X`             → lift `X` BLOCKING (SSR-inline); syntactic, needs no classifier.
  2. `a ?? b` / `||` / `&&`→ NOT lifted; recurse into the operands (pending stays visible to the op).
  3. any other promise/`AsyncIterable` node → lift as a unit, STREAMING; a sync node recurses
     (a sync parent can wrap an async child: `String(getFoo())`, `` `${getFoo()}` ``).

`classify` absent (no warm program) ⇒ only rule 1 fires — fail-open: `await` still works, a bare
async position degrades to today's stringify. A promise seed is emitted `await X` so the cell
UNWRAPS to the resolved value; an `AsyncIterable` seed stays bare (its latest frame). D4: an
`AsyncIterable` in a plain `{#for}` source, or an `await` on an `AsyncIterable`, throw.
*/
export function liftAsyncSubExpressions(
    code: string,
    loc: number,
    classify: InterpolationClassifier | undefined,
    mint: () => string,
    position: LiftPosition = 'content',
): { code: string; lifts: InjectedCell[]; spans: LiftSpan[] } {
    const source = ts.createSourceFile('__lift.ts', code, ts.ScriptTarget.Latest, true)
    const first = source.statements[0]
    /* Only a single bare expression is walkable; anything else (a statement, empty) passes through. */
    if (first === undefined || source.statements.length !== 1 || !ts.isExpressionStatement(first)) {
        return { code, lifts: [], spans: [] }
    }
    const lifts: InjectedCell[] = []
    /* Each lifted span, in walk (source) order; spliced right-to-left so earlier offsets stay valid.
       `start`/`end` index `code`; `name` replaces that span. */
    const edits: { start: number; end: number; name: string }[] = []
    /* The same lifted spans with their kind/tier — the shadow's peek-wrap consumes these directly. */
    const spans: LiftSpan[] = []

    const text = (node: ts.Node): string => code.slice(node.getStart(source), node.getEnd())

    /* The checker kind of a sub-node, keyed by its absolute source offset through the linear
       interpolation→shadow mapping. `undefined` when no classifier (only `await` lifts then). */
    const kindOf = (node: ts.Node): InterpolationKind | undefined => {
        if (classify === undefined) {
            return undefined
        }
        const start = node.getStart(source)
        return classify(loc + start, code.slice(start, node.getEnd()))
    }

    /* Record a lift of `node`'s span. `seed` is the RAW (sub)expression text — `analyzeComponent`
       wraps a `promise` seed as `computed(async () => await (<seed>))` (so `await` is a keyword in
       an async context — a bare-text `await (X)` reparsed at module scope becomes a call to a
       function `await`) and an `asyncIterable` seed as `computed(<seed>)` (a bare stream thunk). */
    const lift = (
        node: ts.Node,
        seed: string,
        kind: 'promise' | 'asyncIterable',
        blocking: boolean,
    ): void => {
        const name = mint()
        const start = node.getStart(source)
        const end = node.getEnd()
        lifts.push({ name, code: seed, kind, blocking })
        edits.push({ start, end, name })
        spans.push({ start, end, kind, blocking })
    }

    const visit = (node: ts.Node): void => {
        /* A nested function is its own evaluation scope — an async (sub)expression inside a callback
           (`items.map(x => fetchName(x))`, `items.map(async x => await load(x))`) must NOT be hoisted
           to a top-level cell: its parameters/closure vars would become free identifiers, and it
           would run once instead of per row. Stop at the boundary, mirroring
           `desugarSignals.hasTopLevelAwait`. */
        if (
            ts.isArrowFunction(node) ||
            ts.isFunctionExpression(node) ||
            ts.isFunctionDeclaration(node)
        ) {
            return
        }
        if (ts.isAwaitExpression(node)) {
            /* `await X` → a BLOCKING promise cell (its operand). D4b: `await` on a stream is
               meaningless. The operand text is already a bounded unary — no parens needed. */
            if (kindOf(node.expression) === 'asyncIterable') {
                throw new AbideCompileError(
                    '[abide] `await` unwraps a promise, but this is an `AsyncIterable` — drop the `await`; a stream auto-tracks (render its frames, or `{#for await}`).',
                    loc + node.getStart(source),
                )
            }
            lift(node, text(node.expression), 'promise', true)
            return
        }
        if (ts.isBinaryExpression(node) && PENDING_TOLERANT.has(node.operatorToken.kind)) {
            /* Pending-tolerant: don't lift the composition — descend so the operator sees the
               operands' `undefined` (`getFoo() ?? 'Loading…'`, `x || getFoo()`). */
            visit(node.left)
            visit(node.right)
            return
        }
        const kind = kindOf(node)
        if (kind === 'promise') {
            /* Lift as a unit, streaming; the cell unwraps the seed to its resolved value. */
            lift(node, text(node), 'promise', false)
            return
        }
        if (kind === 'asyncIterable') {
            if (position === 'each') {
                throw new AbideCompileError(
                    "[abide] an `AsyncIterable` can't drive a plain `{#for}` — iterate its frames with `{#for await}`.",
                    loc + node.getStart(source),
                )
            }
            /* A stream cell: its latest frame. */
            lift(node, text(node), 'asyncIterable', false)
            return
        }
        /* Sync (or classifier-absent): a sync parent can still wrap an async child. */
        ts.forEachChild(node, visit)
    }

    visit(first.expression)

    if (edits.length === 0) {
        return { code, lifts: [], spans: [] }
    }
    edits.sort((a, b) => b.start - a.start)
    let rewritten = code
    for (const edit of edits) {
        rewritten = rewritten.slice(0, edit.start) + edit.name + rewritten.slice(edit.end)
    }
    /* Spans in ascending source order — the shadow's peek-wrap walks them left-to-right. */
    spans.sort((a, b) => a.start - b.start)
    return { code: rewritten, lifts, spans }
}
