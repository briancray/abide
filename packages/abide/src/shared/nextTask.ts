/**
 * Runs `run` in the next task.
 *
 * `setImmediate` where the runtime has one — bun, and so every server — and a `MessageChannel` post
 * in a browser, which has none, clamps a nested `setTimeout` to 4 ms, and throttles a timer in a
 * background tab where it does not throttle a post. The channel is made on first use, so a page that
 * never asks opens none, and one channel serves every caller: what is posted runs in order.
 */
export function nextTask(run: () => void): void {
    if (postTask === null) postTask = taskPoster()
    postTask(run)
}

let postTask: ((run: () => void) => void) | null = null

function taskPoster(): (run: () => void) => void {
    if (typeof setImmediate === 'function')
        return (run) => {
            setImmediate(run)
        }
    const channel = new MessageChannel()
    const queued: (() => void)[] = []
    channel.port1.onmessage = (): void => {
        ;(queued.shift() as () => void)()
    }
    return (run) => {
        queued.push(run)
        channel.port2.postMessage(null)
    }
}
