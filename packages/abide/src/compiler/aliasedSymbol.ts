import {
    type Checker,
    type Symbol as CheckedSymbol,
    SymbolFlags,
} from 'typescript/unstable/async'

/** The symbol an import or a re-export names, or the symbol itself where it is not an alias. */
export function aliasedSymbol(
    checker: Checker,
    symbol: CheckedSymbol,
): Promise<CheckedSymbol> {
    return (symbol.flags & SymbolFlags.Alias) === 0
        ? Promise.resolve(symbol)
        : checker.getAliasedSymbol(symbol)
}
