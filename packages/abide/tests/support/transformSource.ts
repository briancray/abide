import ts from 'typescript'
import { TS_PRINTER } from '../../src/lib/ui/compile/TS_PRINTER.ts'

/* Applies a compile TransformerFactory to a source string and returns the printed result —
   the string→string harness the transformer tests drive. (The shipped pipeline chains these
   factories over ONE parsed tree in lowerScript/lowerContext; only tests want the
   print-per-transform form.) */
export function transformSource(
    code: string,
    factory: ts.TransformerFactory<ts.SourceFile>,
): string {
    const source = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true)
    const result = ts.transform(source, [factory])
    const output = TS_PRINTER.printFile(result.transformed[0] as ts.SourceFile)
    result.dispose()
    return output
}
