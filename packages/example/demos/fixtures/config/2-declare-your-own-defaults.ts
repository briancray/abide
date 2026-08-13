import { config, onConfig } from 'abide/server'

/**
 * The middle layer: abide's floor, then this, then what the operator declared.
 *
 * The app's layer LOSING to the environment is what makes it a default rather than a knob that does
 * nothing — and the hook is handed the environment already assembled, so a default may be computed from
 * one without a null check of its own.
 */
onConfig(() => ({
    ABIDE_LOGS: true,
    GREETING: 'hello',
}))

export function greeting(): string {
    return String(config().GREETING)
}
