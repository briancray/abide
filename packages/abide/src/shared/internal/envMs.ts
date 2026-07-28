import { readEnv } from './readEnv.ts'

// Read a millisecond tunable from the environment, falling back when unset or unusable. Shared by the
// SSR render deadlines (`ABIDE_SSR_DEADLINE`, `ABIDE_SSR_STREAM_BUDGET`) and the RPC run deadline
// (`ABIDE_RPC_TIMEOUT`, ADR 0028 D9) so all three parse identically — a negative or non-numeric value
// is not a zero-length window, it is a typo, and silently arming a 0ms deadline from one would look
// like the framework timing out every call.
export function envMs(name: string, fallback: number): number {
    const raw = readEnv(name)
    const parsed = raw !== undefined ? Number(raw) : Number.NaN
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
