// 38.80 — WHAT THE `onLauncher` A `src/launcher.abide` CALLS ANSWERS: the window the desktop app opens
// and the forms its launcher offers, read as the app launches.

import { isRecord } from '#shared/isRecord.ts'

/**
 * What `onLauncher` may answer. 38.81 — turning off both forms is not one of them, so the checker
 * refuses it where the answer is typed.
 */
export type LauncherOptions = {
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
} & ({ start?: true; connect?: boolean } | { start: false; connect?: true })

/** The options with each default filled in. */
export type Launcher = {
    width: number
    height: number
    minWidth: number
    minHeight: number
    start: boolean
    connect: boolean
}

const SIZES = ['width', 'height', 'minWidth', 'minHeight'] as const
const FORMS = ['start', 'connect'] as const

/**
 * The launcher what `onLauncher` answered sets, or the refusal naming what is wrong with it — read
 * at run time, where an untyped answer can still name a key it does not take.
 */
export function launcherOf(answered: unknown): Launcher | string {
    const launcher: Launcher = {
        width: 1100,
        height: 760,
        minWidth: 480,
        minHeight: 360,
        start: true,
        connect: true,
    }
    if (answered === undefined) return launcher
    if (!isRecord(answered)) return '`onLauncher` answers an object'
    for (const [key, value] of Object.entries(answered)) {
        if (
            (SIZES as readonly string[]).includes(key) &&
            typeof value === 'number' &&
            value > 0
        )
            launcher[key as (typeof SIZES)[number]] = value
        else if (
            (FORMS as readonly string[]).includes(key) &&
            typeof value === 'boolean'
        )
            launcher[key as (typeof FORMS)[number]] = value
        else
            return `\`${key}\` is not a launcher option, or ${JSON.stringify(value)} is not a value it takes`
    }
    // 38.81.
    if (!launcher.start && !launcher.connect)
        return '`onLauncher` turns off both start and connect, which leaves the launcher nothing to do'
    return launcher
}
