// parsePort(argv) — pull `--port <n>` / `--port=<n>` out of an argv tail; returns the parsed port or
// undefined.
//
// Validates the same range as the env-var path (integer, 0..65535) so an invalid `--port` fails cleanly
// instead of flowing a garbage value into Bun.serve/findOpenPort. Shared by the `abide` CLI and by a
// `abide compile` executable, which offers the same flag on its own command line.
//
// Both spellings come from `flagValue`, which is the one place that knows them — this used to re-spell
// the lookup as a bare `indexOf('--port')`, so `abide start --port=8080` bound 3000 in silence and
// `abide dev --port=8080` started its hop search from 3000, dragging the `APP_URL` realignment with it.

import { flagValue } from './flagValue.ts'

export function parsePort(argv: string[]): number | undefined {
    const raw = flagValue(argv, '--port')
    if (raw === undefined) return undefined
    const port = Number(raw)
    return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined
}
