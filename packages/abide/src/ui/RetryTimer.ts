import { retryWait } from '#shared/retryWait.ts'

/**
 * The next attempt at what the network did not answer, waited out as `retryWait` times it from
 * `floor` to `ceiling` — 18.33's mux and 46.8's outbox, each with its own pair.
 */
export class RetryTimer {
    floor: number
    ceiling: number
    /** The retries made since the last reset: how many times the wait has doubled. */
    attempt: number
    timer: ReturnType<typeof setTimeout> | undefined
    fire: () => void

    constructor(floor: number, ceiling: number, attempt: () => void) {
        this.floor = floor
        this.ceiling = ceiling
        this.attempt = 0
        this.timer = undefined
        this.fire = () => {
            this.timer = undefined
            attempt()
        }
    }

    /**
     * Arms the attempt at the wait standing — or at `notBefore`, an epoch ms, where that is later —
     * in place of one armed, and doubles the wait.
     */
    later(notBefore?: number): void {
        clearTimeout(this.timer)
        this.timer = setTimeout(
            this.fire,
            retryWait(this.attempt, this.floor, this.ceiling, notBefore),
        )
        this.attempt += 1
    }

    /**
     * Restarts the wait from the floor, leaving an armed attempt where it is: a call queued
     * mid-send is behind the line the send read, and only the timer reaches it.
     */
    reset(): void {
        this.attempt = 0
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
