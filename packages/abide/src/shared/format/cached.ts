// Every `Intl` formatter the formatters build, by the options it was built with. Building one costs
// about ten calls of it on JSC, and a column formats per row.
export const formatters = new Map<string, unknown>()

/** The formatter `key` names, built by `build` the first time it is asked for. */
export function cached<Formatter>(
    key: string,
    build: () => Formatter,
): Formatter {
    let formatter = formatters.get(key) as Formatter | undefined
    if (formatter === undefined) {
        formatter = build()
        formatters.set(key, formatter)
    }
    return formatter
}
