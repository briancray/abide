import type { Printer } from 'prettier'
import { formatAbideSource } from './formatAbideSource.ts'

/*
Prints the abide AST. The whole file is formatted in one pass by `embed` — the only
hook that can run Prettier's async sub-formatters — which masks the component, reflows
the markup through the HTML engine, and restores the formatted expressions/blocks
(see formatAbideSource). `print` returns the original source as the fallback used
when embedding is skipped.
*/
export const abidePrinter: Printer = {
    print: (path) => path.node.text,
    embed(path, options) {
        const node = path.node
        if (node.type !== 'abide-file') {
            return null
        }
        return () => formatAbideSource(node.text, options)
    },
}
