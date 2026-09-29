// 23.7, 23.8 — WHETHER THE CALLER CAN REACH THE APP. A browser answers with `navigator.onLine` and
// its two events; a server is the app, so it can always reach it.
//
// `window` AND NOT `navigator` tells the two apart: bun defines a `navigator` of its own, with no
// `onLine` on it.
//
// PURE, SO AN APP THAT NEVER NAMES `online` DOES NOT SHIP IT: the listeners are a side effect at
// load, and a top-level side effect keeps the module in the shared chunk whether anything reads it.

import { ambient } from './reactive/index.ts'

/** Whether the caller can reach the app, as a `Reactive<boolean>`. */
export const online = /* @__PURE__ */ (() => {
    if (typeof window === 'undefined') return ambient<boolean>(true)
    const value = ambient<boolean>(navigator.onLine)
    window.addEventListener('online', () => value.set(true))
    window.addEventListener('offline', () => value.set(false))
    return value
})()
