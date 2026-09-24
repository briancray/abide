export function milliseconds(nanoseconds: number): string {
    return (nanoseconds / 1e6).toFixed(2)
}
