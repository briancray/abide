import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'

// The names a `<script>` block binds with `const`, `let` or `var`, in source order. The scanner
// rather than a regex for the same reason `lowerNames` uses one: `const` inside a string is not a
// declaration. A destructuring pattern binds names this does not see, and that is 31.14's case
// rather than this one's.
export function declaredNames(script: string): string[] {
    const scanner = createScanner(true, undefined, script)
    const names: string[] = []
    let expecting = false
    while (true) {
        const kind = scanner.scan()
        if (kind === SyntaxKind.EndOfFile) break
        if (
            kind === SyntaxKind.ConstKeyword ||
            kind === SyntaxKind.LetKeyword ||
            kind === SyntaxKind.VarKeyword
        ) {
            expecting = true
            continue
        }
        if (!expecting) continue
        expecting = false
        if (kind === SyntaxKind.Identifier) {
            const name = scanner.getTokenText()
            if (!names.includes(name)) names.push(name)
        }
    }
    return names
}
