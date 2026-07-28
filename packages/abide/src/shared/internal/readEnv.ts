// Read a framework env var at CALL TIME (never cached) so tests — and a running process that mutates
// `Bun.env` — see live changes. `Bun.env` first, `process.env` as the non-Bun fallback; in a browser
// neither exists and every read is `undefined`.
export function readEnv(name: string): string | undefined {
    const bunEnv = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env
    if (bunEnv !== undefined) return bunEnv[name]
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    return proc?.env?.[name]
}
