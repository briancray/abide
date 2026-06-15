import { effect } from '../../src/lib/ui/effect.ts'
import { scope } from '../../src/lib/ui/runtime/scope.ts'

/*
Drives a reactive read inside a belte-ui effect so belte's createSubscriber-based
consumers (tail/cache/online/health) see a real tracking scope: the first read
opens the underlying resource, dependency changes re-run the effect, and stop()
tears the scope down so last-reader cleanup fires. createSubscriber defers its
open/close reconcile to a microtask, so callers await a tick before reading
current(). belte-ui-native (no Svelte) — replaces the former $effect.root harness.
*/
export function track<T>(read: () => T): { current: () => T | undefined; stop: () => void } {
    let value: T | undefined
    const stop = scope(() => {
        effect(() => {
            value = read()
        })
    })
    return { current: () => value, stop }
}
