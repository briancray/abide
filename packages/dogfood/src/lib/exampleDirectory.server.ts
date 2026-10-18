// WHERE A CHAPTER APP IS ON DISK: `examples/<app>` beside the docs app, walked up to from this module
// rather than computed from its depth, because where the server's modules sit is the build's business.

const APP_NAME = /^crm-\d\d$/

/** The chapter app's directory, or `undefined` for a name that is not one — a name is never a path. */
export async function exampleDirectory(
    app: string,
): Promise<string | undefined> {
    if (!APP_NAME.test(app)) return undefined
    let directory = import.meta.dir
    while (
        !(await Bun.file(`${directory}/examples/${app}/package.json`).exists())
    ) {
        const parent = directory.slice(0, directory.lastIndexOf('/'))
        if (parent === '' || parent === directory) return undefined
        directory = parent
    }
    return `${directory}/examples/${app}`
}
