/*
Reads and parses a project's `package.json`, or undefined when absent. Callers
apply their own field defaults — this centralizes only the exists-check + parse
boilerplate. Bun.file().json() so no Node fs.
*/
export async function readPackageJson(cwd: string): Promise<Record<string, unknown> | undefined> {
    const file = Bun.file(`${cwd}/package.json`)
    return (await file.exists()) ? ((await file.json()) as Record<string, unknown>) : undefined
}
