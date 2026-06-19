import { computed } from '../../src/lib/ui/computed.ts'
import { effect } from '../../src/lib/ui/effect.ts'
import { scope } from '../../src/lib/ui/runtime/scope.ts'

/*
Like reactiveScope's track(), but routes the read through a abide-ui computed so it
evaluates in computed context. abide-ui places no write restriction inside computed,
so this simply asserts a cold cache read survives computed evaluation and the probe
still observes the settle. Built on abide-ui's own scope/computed primitives.
*/
export function trackDerived<T>(read: () => T): { current: () => T | undefined; stop: () => void } {
    let value: T | undefined
    const stop = scope(() => {
        const cell = computed(read)
        effect(() => {
            value = cell.value
        })
    })
    return { current: () => value, stop }
}
