// THE SECOND MEMBER OF THE MACHINERY TRIPLE. CLAUDE.md budgets machinery as LOC over
// vanilla, exported names added, and branches added to a shared path; the third stays
// hand-counted and saying so is better than a table implying otherwise.
//
// Counted off what a module actually HANDS BACK rather than off the source text: a
// barrel re-exporting a name is one name on the surface however many `export` lines
// spell it, and a type-only export is not a name at run time and is not one here.
export async function countExportedNames(
    specifiers: string[],
): Promise<{ total: number; byEntry: Record<string, string[]> }> {
    const byEntry: Record<string, string[]> = {}
    let total = 0
    for (const specifier of specifiers) {
        const names = Object.keys(await import(specifier)).filter(
            (name) => name !== 'default',
        )
        byEntry[specifier] = names.sort()
        total += names.length
    }
    return { total, byEntry }
}
