// 38.81 — `src/bundle/launcher.json`: the window the desktop app opens and the forms its launcher
// offers. Read when `abide bundle` runs and carried in the executable, which reads nothing from the
// source tree when it starts (38.45).

/** What `src/bundle/launcher.json` may set, each with its default filled in. */
export type LauncherOptions = {
    name: string | undefined
    width: number
    height: number
    minWidth: number
    minHeight: number
    start: boolean
    connect: boolean
}

const SIZES = ['width', 'height', 'minWidth', 'minHeight'] as const
const FORMS = ['start', 'connect'] as const

/** The launcher options under `root`, or the refusal naming what is wrong with them. */
export async function launcherOptionsUnder(
    root: string,
): Promise<LauncherOptions | string> {
    const options: LauncherOptions = {
        name: undefined,
        width: 1100,
        height: 760,
        minWidth: 480,
        minHeight: 360,
        start: true,
        connect: true,
    }
    const file = Bun.file(`${root}/bundle/launcher.json`)
    if (!(await file.exists())) return options
    let given: unknown
    try {
        given = await file.json()
    } catch (thrown) {
        return `src/bundle/launcher.json is not JSON — ${(thrown as Error).message}`
    }
    if (given === null || typeof given !== 'object' || Array.isArray(given))
        return 'src/bundle/launcher.json holds an object'
    for (const [key, value] of Object.entries(given)) {
        if (key === 'name' && typeof value === 'string') options.name = value
        else if (
            (SIZES as readonly string[]).includes(key) &&
            typeof value === 'number' &&
            value > 0
        )
            options[key as (typeof SIZES)[number]] = value
        else if (
            (FORMS as readonly string[]).includes(key) &&
            typeof value === 'boolean'
        )
            options[key as (typeof FORMS)[number]] = value
        else
            return `src/bundle/launcher.json: \`${key}\` is not a launcher option, or ${JSON.stringify(value)} is not a value it takes`
    }
    // 38.82.
    if (!options.start && !options.connect)
        return 'src/bundle/launcher.json turns off both start and connect, which leaves the launcher nothing to do'
    return options
}
