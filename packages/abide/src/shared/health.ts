// health() — the ISOMORPHIC health probe (CO2.4). On the SERVER it resolves the framework baseline
// ({ reachable, version } — the running abide version); the `/__abide/health` route composes its stub
// from this and merges the app's `onHealth` over it. On the CLIENT, `await health()` fetches the live
// `/__abide/health` endpoint, so it yields the FULL document (baseline + server-only startedAt/uptime
// + any onHealth-merged app fields) — same call, same intent, both sides (like `online()` differing by
// side). A NAMED json import keeps the client bundle from inlining the rest of package.json.

import { version } from '../../package.json'
import { isBrowser } from './internal/isBrowser.ts'

export async function health(): Promise<{
    reachable: boolean
    version: string
    [k: string]: unknown
}> {
    if (!isBrowser) return { reachable: true, version }
    const response = await fetch('/__abide/health')
    return (await response.json()) as { reachable: boolean; version: string; [k: string]: unknown }
}
