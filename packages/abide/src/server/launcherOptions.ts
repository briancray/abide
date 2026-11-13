// 38.80 — WHAT THE `onLauncher` A `src/native/launcher.abide` CALLS ANSWERS: the window the desktop app opens
// and the forms its launcher offers, read as the app launches.

import { isRecord } from '#shared/isRecord.ts'

/** 38.154 — each material `vibrancy` takes, as its `NSVisualEffectMaterial` raw value. */
export const VIBRANCY_MATERIALS = {
    titlebar: 3,
    selection: 4,
    menu: 5,
    popover: 6,
    sidebar: 7,
    headerView: 10,
    sheet: 11,
    windowBackground: 12,
    hudWindow: 13,
    fullScreenUI: 15,
    toolTip: 17,
    contentBackground: 18,
    underWindowBackground: 21,
    underPageBackground: 22,
} as const

/**
 * What `onLauncher` may answer. 38.81 — turning off both forms is not one of them, so the checker
 * refuses it where the answer is typed.
 */
export type LauncherOptions = {
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    /** 38.142 — the address `abide bundle`'s `updates` directory is served at. */
    update?: string
    maxWidth?: number
    maxHeight?: number
    titlebar?: 'standard' | 'hidden' | 'inset'
    vibrancy?: keyof typeof VIBRANCY_MATERIALS
    appearance?: 'system' | 'light' | 'dark'
    resizable?: boolean
    fullScreen?: boolean
    alwaysOnTop?: boolean
    shadow?: boolean
    rememberFrame?: boolean
    inspector?: boolean
    dock?: boolean
    menuBarExtra?: boolean
    panelWidth?: number
    panelHeight?: number
} & ({ start?: true; connect?: boolean } | { start: false; connect?: true })

/** The options with each default filled in. */
export type Launcher = {
    width: number
    height: number
    minWidth: number
    minHeight: number
    maxWidth: number
    maxHeight: number
    titlebar: NonNullable<LauncherOptions['titlebar']>
    vibrancy: LauncherOptions['vibrancy']
    appearance: NonNullable<LauncherOptions['appearance']>
    resizable: boolean
    fullScreen: boolean
    alwaysOnTop: boolean
    shadow: boolean
    rememberFrame: boolean
    inspector: boolean
    dock: boolean
    menuBarExtra: boolean
    panelWidth: number
    panelHeight: number
    start: boolean
    connect: boolean
    update: string | undefined
}

const SIZES = [
    'width',
    'height',
    'minWidth',
    'minHeight',
    'maxWidth',
    'maxHeight',
    'panelWidth',
    'panelHeight',
] as const
const SWITCHES = [
    'start',
    'connect',
    'resizable',
    'fullScreen',
    'alwaysOnTop',
    'shadow',
    'rememberFrame',
    'inspector',
    'dock',
    'menuBarExtra',
] as const
const CHOICES: Record<string, readonly string[]> = {
    titlebar: ['standard', 'hidden', 'inset'],
    vibrancy: Object.keys(VIBRANCY_MATERIALS),
    appearance: ['system', 'light', 'dark'],
}

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
        maxWidth: Number.POSITIVE_INFINITY,
        maxHeight: Number.POSITIVE_INFINITY,
        titlebar: 'standard',
        vibrancy: undefined,
        appearance: 'system',
        resizable: true,
        fullScreen: true,
        alwaysOnTop: false,
        shadow: true,
        rememberFrame: true,
        inspector: true,
        dock: true,
        menuBarExtra: false,
        panelWidth: 360,
        panelHeight: 480,
        start: true,
        connect: true,
        update: undefined,
    }
    if (answered === undefined) return launcher
    if (!isRecord(answered)) return '`onLauncher` answers an object'
    const set = launcher as Record<string, unknown>
    for (const [key, value] of Object.entries(answered)) {
        if (
            (SIZES as readonly string[]).includes(key) &&
            typeof value === 'number' &&
            value > 0
        )
            set[key] = value
        else if (
            (SWITCHES as readonly string[]).includes(key) &&
            typeof value === 'boolean'
        )
            set[key] = value
        else if (
            Object.hasOwn(CHOICES, key) &&
            (CHOICES[key] as readonly unknown[]).includes(value)
        )
            set[key] = value
        else if (
            key === 'update' &&
            typeof value === 'string' &&
            URL.canParse(value)
        )
            set[key] = value
        else
            return `\`${key}\` is not a launcher option, or ${JSON.stringify(value)} is not a value it takes`
    }
    // 38.81.
    if (!launcher.start && !launcher.connect)
        return '`onLauncher` turns off both start and connect, which leaves the launcher nothing to do'
    // 38.151.
    if (
        launcher.maxWidth < launcher.minWidth ||
        launcher.maxHeight < launcher.minHeight
    )
        return '`onLauncher` answers a maximum size below its minimum size'
    return launcher
}
