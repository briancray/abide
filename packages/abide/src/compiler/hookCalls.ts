import { SHARED_SPECIFIER } from '#shared/SPECIFIERS.ts'
import { importStatements } from './splitImports.ts'
import { type Token, tokenize } from './tokenize.ts'

// WHICH OF ABIDE'S HOOKS A MODULE CALLS, read off its tokens and its imports — not run. What `abide
// routes` lists (38.108), what the build refuses where a call is never read (37.13, 38.107), and
// which files the checker types `Config` off (27.13) all ask this one question.

/** Every hook abide exports, by name. */
export const HOOK_NAMES: ReadonlySet<string> = new Set([
    'middleware',
    'onStart',
    'onStop',
    'onError',
    'onConfig',
    'onHealth',
    'onPrincipal',
    'onLauncher',
    'onMenu',
])

/** One call of one of abide's hooks. */
export type HookCall = {
    hook: string
    /** Where the callee starts — the hook's name, or the namespace it is a member of. */
    at: number
    /** Where the callee ends: the `(` follows. */
    end: number
    /** Whether the call stands as a statement at the module's top level. */
    topLevel: boolean
}

/**
 * What `scripts`' imports from abide bind: each local name, a value's, to the name it imports — `*`
 * for a namespace. Every script of one file, since a `<script module>`'s import reaches the blocks
 * below it.
 */
export function abideBindings(
    scripts: readonly string[],
): ReadonlyMap<string, string> {
    const bound = new Map<string, string>()
    for (const script of scripts) {
        if (!script.includes(SHARED_SPECIFIER)) continue
        for (const statement of importStatements(script))
            if (isAbideSpecifier(statement.specifier))
                for (const binding of statement.bindings)
                    if (!binding.typeOnly)
                        bound.set(binding.local, binding.imported)
    }
    return bound
}

/**
 * Each of abide's hooks `scripts` call — every script of one file — in the order written. Block by
 * block: one block's last token would decide how the next one's first reads.
 */
export function hooksIn(scripts: readonly string[]): string[] {
    const bindings = abideBindings(scripts)
    const hooks: string[] = []
    for (const script of scripts)
        for (const call of hookCalls(script, bindings)) hooks.push(call.hook)
    return hooks
}

/**
 * Each of abide's hooks `source` calls, in the order written.
 *
 * A HOOK IS WHAT ABIDE HANDED THE MODULE: a name `bindings` imports from abide, under whatever local
 * name, or a member of a namespace it does — `server.onStart(…)` is the hook, and `emitter.onError(…)`
 * in a module importing abide for `reactive` is not.
 */
export function hookCalls(
    source: string,
    bindings: ReadonlyMap<string, string> = abideBindings([source]),
): HookCall[] {
    const calls: HookCall[] = []
    // Untokenized where no name a hook is bound to — itself, or the namespace holding it — is in it.
    let mentioned = false
    for (const [local, imported] of bindings)
        if (
            (imported === '*' || HOOK_NAMES.has(imported)) &&
            source.includes(local)
        ) {
            mentioned = true
            break
        }
    if (!mentioned) return calls
    const tokens = tokenize(source)
    let depth = 0
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] as Token
        const text = token.text
        if (text === '(' || text === '[' || text === '{') depth += 1
        else if (text === ')' || text === ']' || text === '}') depth -= 1
        if (tokens[index + 1]?.text !== '(') continue
        const previous = tokens[index - 1]
        let hook: string | undefined
        let first = index
        if (previous?.text === '.') {
            const owner = tokens[index - 2]
            if (
                HOOK_NAMES.has(text) &&
                owner !== undefined &&
                bindings.get(owner.text) === '*' &&
                tokens[index - 3]?.text !== '.'
            ) {
                hook = text
                first = index - 2
            }
        } else if (previous?.text !== 'function') {
            const imported = bindings.get(text)
            if (imported !== undefined && HOOK_NAMES.has(imported))
                hook = imported
        }
        if (hook === undefined) continue
        const callee = tokens[first] as Token
        calls.push({
            hook,
            at: callee.start,
            end: token.end,
            topLevel: depth === 0 && opensStatement(source, tokens, first),
        })
    }
    return calls
}

// Whether the token at `index` begins a statement: the first, after a `;` or a `}`, or on a line of
// its own after one that ended an expression — where a formatted module writes one.
function opensStatement(
    source: string,
    tokens: readonly Token[],
    index: number,
): boolean {
    const previous = tokens[index - 1]
    if (previous === undefined) return true
    if (previous.text === ';' || previous.text === '}') return true
    return (
        source
            .slice(previous.end, (tokens[index] as Token).start)
            .includes('\n') && ENDS_EXPRESSION.test(previous.text)
    )
}

const ENDS_EXPRESSION = /^(?:[\w$]+|[)\]]|['"`].*)$/s

/** `@abide/abide` or one of its subpaths. */
export function isAbideSpecifier(specifier: string): boolean {
    return (
        specifier === SHARED_SPECIFIER ||
        specifier.startsWith(`${SHARED_SPECIFIER}/`)
    )
}
