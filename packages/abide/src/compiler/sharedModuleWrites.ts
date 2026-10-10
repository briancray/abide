import { type Node, NodeFlags } from 'typescript/unstable/ast'
import {
    isVariableDeclaration,
    isVariableDeclarationList,
} from 'typescript/unstable/ast/is'
import type {
    Symbol as CheckedSymbol,
    Checker,
} from 'typescript/unstable/async'
import { classifyRead, FUNCTIONS } from './classifyRead.ts'
import type { Finding } from './Finding.ts'
import type { Span } from './projectShadow.ts'

// 34.19 — A PLAIN `let` IN A `<script module>` THAT A `<script>` WRITES AS IT SETS UP. The block is
// module scope (34.2), which a server shares across every request, and setup runs inside a render —
// so the value one request leaves is the one the next request starts from, and its markup drifts
// from what the browser builds. A `reactive` is per request wherever it is declared (11.32), which
// is the fix the warning names. A write inside a function runs when that function is called — a
// handler, in a browser — and is left alone: the warning is for what a render does.

/**
 * The writes a `<script>` makes, outside any function, to a plain `let` or `var` its file's
 * `<script module>` declares.
 *
 * `names`, `symbols` and `reactive` are `readsIn`'s top-level names, aligned, and `reactive` holds
 * the symbol only where the name is a `Reactive`.
 */
export async function sharedModuleWrites(
    checker: Checker,
    shadowPath: string,
    names: readonly Node[],
    symbols: readonly (CheckedSymbol | undefined)[],
    reactive: readonly (CheckedSymbol | undefined)[],
    modules: Span,
    scripts: Span,
): Promise<Finding[]> {
    const shared: { name: string; symbol: CheckedSymbol }[] = []
    for (let at = 0; at < names.length; at += 1) {
        const name = names[at] as Node
        const symbol = symbols[at]
        const start = name.getStart()
        if (
            symbol === undefined ||
            reactive[at] !== undefined ||
            start < modules.start ||
            start >= modules.end
        )
            continue
        const declaration = name.parent
        const list = declaration?.parent
        if (
            !isVariableDeclaration(declaration) ||
            list === undefined ||
            !isVariableDeclarationList(list) ||
            (list.flags & NodeFlags.Const) !== 0
        )
            continue
        shared.push({ name: (name as { text?: string }).text ?? '', symbol })
    }
    if (shared.length === 0) return []
    const warnings: Finding[] = []
    for (const { name, symbol } of shared) {
        const references = await checker.getReferencesToSymbolInFile(
            shadowPath,
            symbol,
        )
        for (const reference of references) {
            const node = await reference.resolve()
            if (node === undefined) continue
            const at = node.getStart()
            if (at < scripts.start || at >= scripts.end) continue
            const shape = classifyRead(node)?.shape
            if (shape !== 'write' && shape !== 'update') continue
            if (insideFunction(node)) continue
            warnings.push({
                at,
                message: `abide: \`${name}\` is a plain \`let\` in <script module>, which a server shares across every request, and this <script> writes it while the page renders — so one request's value is where the next one starts. Declare it with \`reactive\`, which is per request wherever it stands, or move it into <script>. RULEBOOK 34.19.`,
            })
        }
    }
    return warnings
}

function insideFunction(node: Node): boolean {
    for (let parent = node.parent; parent !== undefined; parent = parent.parent)
        if (FUNCTIONS.has(parent.kind)) return true
    return false
}
