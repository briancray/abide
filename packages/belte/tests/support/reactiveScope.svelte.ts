/*
Drives a reactive read inside an $effect.root so belte's createSubscriber-based
consumers (subscribe/cache) see a real Svelte tracking scope: the first read
opens the underlying resource, dependency changes re-run the effect, and stop()
tears the scope down so last-reader cleanup fires. Effects flush on the
scheduler's microtask, so callers await their source's frames (a tick) before
reading current(). Compiled via the Svelte module loader in sveltePreload.ts.
*/
export function track<T>(read: () => T): { current: () => T | undefined; stop: () => void } {
    let value: T | undefined
    const stop = $effect.root(() => {
        $effect(() => {
            value = read()
        })
    })
    return { current: () => value, stop }
}
