import {
    type CallExpression,
    type Node,
    SyntaxKind,
} from 'typescript/unstable/ast'
import {
    isArrowFunction,
    isCallExpression,
    isFunctionExpression,
    isIdentifier,
    isPropertyAccessExpression,
    isPropertyAssignment,
} from 'typescript/unstable/ast/is'
import type { Checker } from 'typescript/unstable/async'
import { aliasedSymbol } from './aliasedSymbol.ts'
import { optionNamed, reactiveOptions } from './reactiveOptions.ts'

// 11.37 — A `global` VALUE'S BODY READING WHAT ONLY A REQUEST HAS. A `global` value is one for the
// whole process (11.34), so a body reading the request it happened to be built in answers every
// later request with the first one's `principal`, `cookies` or `route` — the one failure a page
// served to one person at a time never shows.
//
// WHAT THE BODY READS ITSELF, by the checker's own symbols: an app's `route` is not abide's, and
// abide's imported under another name is. A read reached through a function the body calls is not
// seen, and is the same limit 14.16 has.

const besideThis = (relative: string): string =>
    new URL(relative, import.meta.url).pathname

// Where abide declares each ambient, and whether only its `.nonce` belongs to the request.
const AMBIENTS: { path: string; name: string; nonce: boolean }[] = [
    {
        path: besideThis('../server/requestScope.ts'),
        name: 'request',
        nonce: false,
    },
    {
        path: besideThis('../server/requestScope.ts'),
        name: 'response',
        nonce: false,
    },
    {
        path: besideThis('../shared/principal.ts'),
        name: 'principal',
        nonce: false,
    },
    { path: besideThis('../shared/cookies.ts'), name: 'cookies', nonce: false },
    { path: besideThis('../shared/csp.ts'), name: 'csp', nonce: true },
    { path: besideThis('../shared/route.ts'), name: 'route', nonce: false },
]

/** The modules that declare abide's per-request ambients, each once. */
export const AMBIENT_SOURCES: string[] = [
    ...new Set(AMBIENTS.map((ambient) => ambient.path)),
]

/**
 * Where a `global` reactive's body reads a per-request ambient, in source order.
 *
 * `paths` maps each of `AMBIENT_SOURCES` to the path the checker names it by (`declaredExports` has
 * the reason: the checker folds case on a case-insensitive disk).
 */
export async function ambientReadsIn(
    checker: Checker,
    sourceFile: Node,
    paths: Map<string, string>,
): Promise<{ at: number; ambient: string }[]> {
    // EVERY NAME A `global` BODY USES, whatever it is spelled: which ones are abide's ambients is
    // the symbol's answer.
    const candidates: Node[] = []
    const collect = (node: Node): void => {
        if (isIdentifier(node) && isUse(node)) candidates.push(node)
        node.forEachChild((child) => {
            collect(child)
            return undefined
        })
    }
    const visit = (node: Node): void => {
        if (isCallExpression(node) && isGlobalReactive(node)) {
            const body = node.arguments[0]
            if (body !== undefined) collect(body)
        }
        node.forEachChild((child) => {
            visit(child)
            return undefined
        })
    }
    visit(sourceFile)
    if (candidates.length === 0) return []
    const symbols = await checker.getSymbolAtLocation(candidates)
    const found: { at: number; ambient: string }[] = []
    await Promise.all(
        candidates.map(async (node, at) => {
            const symbol = symbols[at]
            if (symbol === undefined) return
            const target = await aliasedSymbol(checker, symbol)
            const declared = target.valueDeclaration?.path
            if (declared === undefined) return
            for (const ambient of AMBIENTS)
                if (
                    ambient.name === target.name &&
                    declared === paths.get(ambient.path) &&
                    (!ambient.nonce || readsNonce(node))
                )
                    found.push({
                        at: node.getStart(),
                        ambient: ambient.nonce
                            ? `${ambient.name}.nonce`
                            : ambient.name,
                    })
        }),
    )
    found.sort((one, two) => one.at - two.at)
    return found
}

/** Whether a call is `reactive(() => …, { global: true })`, the option a literal `true`. */
function isGlobalReactive(call: CallExpression): boolean {
    const options = reactiveOptions(call)
    const body = call.arguments[0]
    return (
        options !== undefined &&
        body !== undefined &&
        (isArrowFunction(body) || isFunctionExpression(body)) &&
        optionNamed(options, 'global')?.kind === SyntaxKind.TrueKeyword
    )
}

/** Whether a name stands for a value, rather than a property or a key that spells one. */
function isUse(node: Node): boolean {
    const parent = node.parent
    if (isPropertyAccessExpression(parent) && parent.name === node) return false
    return !(isPropertyAssignment(parent) && parent.name === node)
}

/**
 * Whether the name is read as `name.nonce`.
 *
 * `csp` is one per request only in its `nonce`.
 */
function readsNonce(node: Node): boolean {
    const parent = node.parent
    return (
        isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        isIdentifier(parent.name) &&
        parent.name.text === 'nonce'
    )
}
