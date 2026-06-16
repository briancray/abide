import { derived } from '../../src/lib/ui/derived.ts'
import { effect } from '../../src/lib/ui/effect.ts'
import { scope } from '../../src/lib/ui/runtime/scope.ts'

/*
Like reactiveScope's track(), but routes the read through a abide-ui derived so it
evaluates in derived context. abide-ui places no write restriction inside derived
(unlike Svelte's state_unsafe_mutation), so this now simply asserts a cold cache
read survives derived evaluation and the probe still observes the settle.
abide-ui-native (no Svelte) — replaces the former $derived.by harness.
*/
export function trackDerived<T>(read: () => T): { current: () => T | undefined; stop: () => void } {
    let value: T | undefined
    const stop = scope(() => {
        const computed = derived(read)
        effect(() => {
            value = computed.value
        })
    })
    return { current: () => value, stop }
}
