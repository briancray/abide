/** What `onError` reports to: the last three messages a tracker was sent. */
export const tracker = {
    captured: [] as string[],
    capture(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error)
        tracker.captured = [message, ...tracker.captured].slice(0, 3)
    },
}
