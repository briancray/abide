import { reactive } from '@abide/abide'

// 10 — the handles the share tests call, declared once as an app declares one.
export const nowPlaying = reactive.shared(() => 'nothing')
export const queued = reactive.shared(() => '')
export const library = reactive.shared(() => 'everything')
export const volume = reactive.shared(() => 4)
export const theme = reactive.shared(() => 'own')
export const headings = reactive.shared((): string[] => [])
export const count = reactive.shared(() => 0)
