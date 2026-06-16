import { ABIDE_PACKAGE_NAME } from './ABIDE_PACKAGE_NAME.ts'
import { readPackageJson } from './readPackageJson.ts'

/*
Resolves the bare specifier prefix a consuming project imports abide under —
the name abide is installed as in its package.json. A project may depend on
abide directly (`abide`) or behind a package alias
(`"abide": "npm:abide@..."`, or `workspace:abide@*`
inside this repo). An alias-only install resolves only under the alias key and
a direct install only under the canonical name, so the generated rpc / socket
/ prompt modules must import under whichever name the project
declared.

Prefers a `abide` alias (the ergonomic surface the docs use) when present, then
a direct canonical dependency, then any other alias targeting abide. Falls back
to the canonical name when abide isn't found in package.json — the build can't
resolve abide at all in that case, and the canonical name yields the clearest
resolution error.
*/
export async function abideImportName(cwd: string): Promise<string> {
    const packageJson = (await readPackageJson(cwd)) as
        | { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
        | undefined
    if (!packageJson) {
        return ABIDE_PACKAGE_NAME
    }
    const dependencies = { ...packageJson.devDependencies, ...packageJson.dependencies }
    /*
    Alias entries whose target is abide — `npm:` for a published install,
    `workspace:` for the in-repo examples. The key is the name the project
    imports under; the version suffix (`@^0.2.0`, `@*`) is optional.
    */
    const aliasPattern = new RegExp(`^(npm|workspace):${ABIDE_PACKAGE_NAME}(@.*)?$`)
    const aliasNames = Object.entries(dependencies)
        .filter(([, specifier]) => aliasPattern.test(specifier))
        .map(([name]) => name)
    if (aliasNames.includes('abide')) {
        return 'abide'
    }
    if (ABIDE_PACKAGE_NAME in dependencies) {
        return ABIDE_PACKAGE_NAME
    }
    return aliasNames[0] ?? ABIDE_PACKAGE_NAME
}
