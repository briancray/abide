/**
 * The label and tone a bench or test row shows in place of a reading, by run state.
 *
 * `none` is a row no run has reached yet. Both boards read it, so the two pages say "queued" the
 * same way. A tone is Tailwind utilities written out whole, which is what lets the scanner find
 * a class no markup names.
 */
export const ROW_STATES = {
    none: { label: 'not run', tone: 'text-muted' },
    queued: { label: 'queued', tone: 'text-muted' },
    running: { label: 'running', tone: 'text-signal animate-board-pulse' },
    broken: { label: 'broken', tone: 'text-bad' },
    done: { label: '', tone: '' },
}
