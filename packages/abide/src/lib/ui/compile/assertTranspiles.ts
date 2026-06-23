/*
Fail-loud guard for generated code. The compile passes build modules as strings and
AST — a corruption (an un-handled rewrite position, a generator bug, a stale lowering)
otherwise ships as a broken bundle that fails opaquely at load. Transpiling the output
turns it into a compile-time error naming the stage and showing the offending source.
`context` labels which stage produced it. Compile-time only; never on the hot path.
*/

const transpiler = new Bun.Transpiler({ loader: 'ts' })

export function assertTranspiles(code: string, context: string): void {
    try {
        transpiler.transformSync(code)
    } catch (error) {
        throw new Error(
            `[abide] ${context} produced invalid syntax — please report this with the component source. Output:\n${code}\n\n${String(error)}`,
        )
    }
}
