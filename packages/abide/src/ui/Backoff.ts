/**
 * The next attempt at what the network did not answer, waiting from `floor` to `ceiling`, doubling —
 * 18.33's mux and 46.8's outbox, each with its own pair.
 */
export class Backoff {
    floor: number
    ceiling: number
    wait: number
    timer: ReturnType<typeof setTimeout> | undefined
    fire: () => void

    constructor(floor: number, ceiling: number, attempt: () => void) {
        this.floor = floor
        this.ceiling = ceiling
        this.wait = floor
        this.timer = undefined
        this.fire = () => {
            this.timer = undefined
            attempt()
        }
    }

    /** Arms the attempt at the wait standing, in place of one armed, and doubles the wait. */
    later(): void {
        clearTimeout(this.timer)
        this.timer = setTimeout(this.fire, this.wait)
        this.wait = Math.min(this.wait * 2, this.ceiling)
    }

    /**
     * Restarts the wait from the floor, leaving an armed attempt where it is: a call queued
     * mid-send is behind the line the send read, and only the timer reaches it.
     */
    reset(): void {
        this.wait = this.floor
    }

    cancel(): void {
        clearTimeout(this.timer)
        this.timer = undefined
    }

    /**
     * Resets the wait and makes `attempt` now where the browser comes online or the page into view.
     *
     * 18.33, 46.8 — THE BACKOFF IS FOR A SERVER THAT IS DOWN, not for a network that has just come
     * back or a tab whose timers the browser was throttling while it was hidden.
     */
    whenReachable(attempt: () => void): void {
        const now = (): void => {
            this.reset()
            attempt()
        }
        addEventListener('online', now)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') now()
        })
    }
}
