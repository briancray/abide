import { state, watch } from 'abide'

// The last save as a VALUE rather than an event, so anything may
// read it without the editor knowing who did.
export const savedAt = state('never')

// The TRACKED form: it runs immediately and again whenever
// anything it READ moves, with no dependency list to keep. It is
// registered from a plain module rather than a component, so
// nothing owns it and nothing will tear it down — the disposer it
// hands back is what you have.
export const stopBeacon = watch(() => {
    navigator.sendBeacon('/telemetry', savedAt())
})

// `s.watch(effect)` is the same thing scoped to one value, handing
// the value to the effect rather than making the effect read one.
export const stopTitle = savedAt.watch((at) => {
    document.title = at === 'never' ? 'Draft' : `Draft — saved ${at}`
})
