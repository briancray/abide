import { log } from '../../shared/log.ts'

// How much of the response surface this process compresses, from `ABIDE_COMPRESS`.
//
//   `static` (DEFAULT) — serve the brotli/gzip variants `abide build` already computed for the
//     content-addressed `/__abide/chunk/` assets. Free at request time: the bytes were compressed once,
//     at build, and are served until the content hash changes.
//   `all` — additionally compress DYNAMIC responses per request: streamed HTML documents and buffered
//     JSON. This one costs CPU on every response, which is why it is not the default.
//   `off` — no compression anywhere, including the precompressed chunk variants.
//
// The default is `static` rather than `all` because most `abide start` deployments sit behind a proxy
// or CDN that already compresses, and compressing twice is a bug rather than a redundancy — the second
// pass spends CPU to grow the payload. The surfaces with no proxy in front of them (`abide compile`'s
// standalone binary, `abide bundle`'s desktop app) are exactly the ones that should set `all`.
export function compressionMode(): 'off' | 'static' | 'all' {
    const raw = Bun.env.ABIDE_COMPRESS
    if (raw === undefined || raw.length === 0) return 'static'
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'off' || normalized === 'static' || normalized === 'all') return normalized
    warnUnrecognized(normalized)
    return 'static'
}

// Once per process, not per request: an unrecognized value is a boot-time misconfiguration, and this is
// consulted on every response.
let warned = false

function warnUnrecognized(value: string): void {
    if (warned) return
    warned = true
    log.channel('abide:router').warn(
        `ABIDE_COMPRESS="${value}" is not one of off | static | all — falling back to "static".`,
    )
}
