// The timing harness, identical in all three apps: run an operation, wait for the paint that follows
// it, and record the elapsed time under a name the driver reads off `window.__bench`.

export interface BenchWindow {
    __bench?: Record<string, number>
    __ops?: Record<string, () => void>
    __hydrated?: number
}

export function afterPaint(): Promise<void> {
    return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0)
        })
    })
}

export function record(name: string, ms: number): void {
    const holder = globalThis as unknown as BenchWindow
    const bench = holder.__bench ?? {}
    bench[name] = ms
    holder.__bench = bench
}

export function expose(ops: Record<string, () => void>): void {
    if (typeof window === 'undefined') return
    const holder = globalThis as unknown as BenchWindow
    holder.__ops = ops
}
