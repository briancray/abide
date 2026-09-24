export function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)] as number
}

export function spread(
    values: number[],
    format: (value: number) => string,
): string {
    return `${format(Math.min(...values))} – ${format(Math.max(...values))}`
}

export function percent(share: number): string {
    return `${(share * 100).toFixed(1)}%`
}
