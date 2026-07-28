// parsePort(argv) — pull `--port <n>` out of an argv tail; returns the parsed port or undefined.
//
// Validates the same range as the env-var path (integer, 0..65535) so an invalid `--port` fails cleanly
// instead of flowing a garbage value into Bun.serve/findOpenPort. Shared by the `abide` CLI and by a
// `abide compile` executable, which offers the same flag on its own command line.
export function parsePort(argv: string[]): number | undefined {
    const index = argv.indexOf('--port')
    if (index === -1) return undefined
    const raw = argv[index + 1]
    if (raw === undefined) return undefined
    const port = Number(raw)
    return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined
}
