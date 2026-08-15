import { health } from 'abide'

/**
 * abide fills in a floor — `reachable`, `version`, `startedAt`, `uptime` — so a reader asks one question
 * rather than branching on which fields an app remembered to report.
 */
export async function reachable(): Promise<boolean> {
    return (await health()).reachable
}
