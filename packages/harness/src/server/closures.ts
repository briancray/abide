// A CLOSURE IS A PAIR, and this exists so nobody re-derives which pair. JSC reports
// one as a `Function` and a `JSLexicalEnvironment` together; confirmed under bun
// 1.4.2, five closures move the pair by exactly +5/+5 after a `fullGC`, and `Scope`
// never appears as a key at all.

import { retained } from './retained.ts'

export function closures(body: () => unknown): {
    Function: number
    JSLexicalEnvironment: number
} {
    const diff = retained(body)
    return {
        Function: diff.Function ?? 0,
        JSLexicalEnvironment: diff.JSLexicalEnvironment ?? 0,
    }
}
