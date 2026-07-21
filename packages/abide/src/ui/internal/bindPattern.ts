import { extractBindingNames } from './analyzeScope.ts'

// Emit statement(s) binding `pattern` from `valueExpr` onto the scope object `target`. A bare
// identifier is a direct `target["x"] = value` assignment; a destructuring pattern runs an IIFE that
// binds the pattern then `Object.assign`s the extracted names back onto `target`.
export function bindPattern(target: string, pattern: string, valueExpr: string): string {
    const trimmed = pattern.trim()
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed))
        return `${target}[${JSON.stringify(trimmed)}] = ${valueExpr};`
    const names = extractBindingNames(trimmed)
    return `Object.assign(${target}, (() => { const ${trimmed} = ${valueExpr}; return { ${names.join(', ')} }; })());`
}
