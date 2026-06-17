import { afterEach, expect, test } from 'bun:test'
import { UI_RUNTIME_IMPORTS } from '../src/lib/ui/compile/UI_RUNTIME_IMPORTS.ts'
import { installHotBridge } from '../src/lib/ui/installHotBridge.ts'
import { hotReloadEnabled } from '../src/lib/ui/runtime/hotReloadEnabled.ts'

afterEach(() => {
    hotReloadEnabled.current = false
    delete (globalThis as { __abide?: unknown }).__abide
})

/* The bridge a hot module reads from must expose exactly what the hot module
   destructures — the UI_RUNTIME_IMPORTS names plus hotReplace — or a hot load
   throws on a missing binding. This pins the two lists together. */
test('installHotBridge exposes the runtime names + hotReplace and flips the flag', () => {
    installHotBridge()
    const bridge = (globalThis as { __abide?: Record<string, unknown> }).__abide ?? {}
    const expected = [...UI_RUNTIME_IMPORTS.map((entry) => entry.name), 'hotReplace'].sort()
    expect(Object.keys(bridge).sort()).toEqual(expected)
    for (const name of expected) {
        expect(typeof bridge[name]).toBe('function')
    }
    expect(hotReloadEnabled.current).toBe(true)
})
