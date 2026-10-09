// What `onError` reports to: the last few messages a tracker was sent.

const KEPT = 3

export const errorReportTracker = {
    captured: [] as string[],
    capture(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error)
        this.captured = [message, ...this.captured].slice(0, KEPT)
    },
}
