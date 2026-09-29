/**
 * The label and tone a bench or test row shows in place of a reading, by run state.
 *
 * `none` is a row no run has reached yet. Both boards read it, so the two pages say "queued" the
 * same way.
 */
export const ROW_STATES = {
    none: { label: 'not run', tone: 'board-waiting' },
    queued: { label: 'queued', tone: 'board-waiting' },
    running: { label: 'running', tone: 'board-running' },
    broken: { label: 'broken', tone: 'board-bad' },
    done: { label: '', tone: '' },
}
