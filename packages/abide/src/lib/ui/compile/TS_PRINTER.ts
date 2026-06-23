import ts from 'typescript'

/* The shared TypeScript printer every compile pass prints its transformed tree with.
   A `ts.Printer` is stateless and reusable, so the passes share one instance rather
   than each re-creating the same `{ newLine: LineFeed }` printer. LineFeed keeps the
   emitted source `\n`-delimited regardless of the host platform. */
export const TS_PRINTER = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
