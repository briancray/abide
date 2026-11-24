// 50.74 — the notices abide builds for an app: no `initial`, no `store`, every timeout its default.
import { notices } from './notices.ts'

/** Notices that take themselves down, shown where the app spreads `toasts.host`. */
export const toasts = notices()
