/** Loads settled by hand, so a case can hold a set of values busy between two lines. */
export function deferredLoads(): {
    load: () => Promise<number>
    settleAll: (value: number) => void
} {
    const settles: ((value: number) => void)[] = []
    return {
        load: () =>
            new Promise<number>((resolve) => {
                settles.push(resolve)
            }),
        settleAll: (value) => {
            for (const settle of settles.splice(0)) settle(value)
        },
    }
}
