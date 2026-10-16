/** The middle of `values` once sorted — the upper middle for an even count. */
export function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)] as number
}

/** The lowest and highest of `values`, formatted, as `low – high`. */
export function spread(
    values: number[],
    format: (value: number) => string,
): string {
    return `${format(Math.min(...values))} – ${format(Math.max(...values))}`
}

/** A fraction as a percentage string, to one decimal place. */
export function percent(share: number): string {
    return `${(share * 100).toFixed(1)}%`
}
