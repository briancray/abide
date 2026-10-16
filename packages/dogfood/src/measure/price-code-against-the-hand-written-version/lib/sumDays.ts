/** Ninety days of signups, newest last. */
export const SIGNUPS: number[] = []
for (let day = 0; day < 90; day += 1) SIGNUPS.push(12 + ((day * 7) % 9))

/** Signups over the last `days` days. */
export function sumDays(days: number): number {
    let total = 0
    for (let at = SIGNUPS.length - days; at < SIGNUPS.length; at += 1)
        total += SIGNUPS[at] as number
    return total
}
