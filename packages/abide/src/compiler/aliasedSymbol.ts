import type { CallExpression, Node } from 'typescript/unstable/ast'
import { isPropertyAccessExpression } from 'typescript/unstable/ast/is'
import {
    type Checker,
    type Symbol as CheckedSymbol,
    SymbolFlags,
} from 'typescript/unstable/async'

/** The node naming what `call` calls: `f` in `f(…)` and in `ns.f(…)`, for the checker to name. */
export function calleeNameOf(call: CallExpression): Node {
    return isPropertyAccessExpression(call.expression)
        ? call.expression.name
        : call.expression
}

/** The symbol an import or a re-export names, or the symbol itself where it is not an alias. */
export function aliasedSymbol(
    checker: Checker,
    symbol: CheckedSymbol,
): Promise<CheckedSymbol> {
    return (symbol.flags & SymbolFlags.Alias) === 0
        ? Promise.resolve(symbol)
        : checker.getAliasedSymbol(symbol)
}

/**
 * Whether `node` names abide's export `name`, declared in the file at `path` as the checker names it
 * (`abideIn`) — through any import or re-export, and never an app's own binding of the same name.
 */
export async function namesAbide(
    checker: Checker,
    node: Node,
    name: string,
    path: string | undefined,
): Promise<boolean> {
    if (path === undefined) return false
    const symbol = await checker.getSymbolAtLocation(node)
    if (symbol === undefined) return false
    const target = await aliasedSymbol(checker, symbol)
    return target.name === name && target.valueDeclaration?.path === path
}
