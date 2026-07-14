import ts from 'typescript'
import { hasTopLevelAwait } from './hasTopLevelAwait.ts'

const factory = ts.factory

/* Normalises a `computed`/`linked` argument into a seed THUNK: a literal `() => …` /
   `function` argument passes through unchanged (the author already wrote the thunk), any
   other expression is wrapped as `() => arg`. The wrapper arrow is made ASYNC when the
   expression contains a top-level `await` (`computed(await load())` → `async () => await
   load()`), which is exactly the marker the runtime primitive uses to route to an async cell.
   Shared by the top-level desugar (`desugarSignals`) and the nested-`<script>` lowering
   (`wrapReactiveSeeds`) so a bare-value seed is normalised identically on both surfaces. */
export function wrapSeed(argument: ts.Expression): ts.Expression {
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
        return argument
    }
    const modifiers = hasTopLevelAwait(argument)
        ? [factory.createModifier(ts.SyntaxKind.AsyncKeyword)]
        : undefined
    return factory.createArrowFunction(
        modifiers,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        argument,
    )
}
