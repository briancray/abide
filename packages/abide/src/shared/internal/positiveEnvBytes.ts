// Parse an env var as a positive byte count, or Infinity (the unbounded default) when unset, empty,
// or invalid. Read fresh at each call so operators (and tests) can change the ceiling at runtime.
export function positiveEnvBytes(name: string): number {
    const raw = Bun.env[name]
    if (raw === undefined || raw === '') return Infinity
    const bytes = Number(raw)
    return Number.isFinite(bytes) && bytes > 0 ? bytes : Infinity
}
