import type { Node } from 'typescript/unstable/ast'
import type {
    Checker,
    Symbol as CheckedSymbol,
} from 'typescript/unstable/async'

/** Every node that references `symbol` in the file at `path`, resolved — `undefined` where one cannot be. */
export async function referencesIn(
    checker: Checker,
    path: string,
    symbol: CheckedSymbol | undefined,
): Promise<(Node | undefined)[]> {
    if (symbol === undefined) return []
    const references = await checker.getReferencesToSymbolInFile(path, symbol)
    return Promise.all(references.map((reference) => reference.resolve()))
}
