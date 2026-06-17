/* Marker pair fencing the abide block, so a re-run replaces it in place rather
   than duplicating, and the rest of an existing CLAUDE.md stays untouched. */
const GUIDE_START = '<!-- abide:agent-guide -->'
const GUIDE_END = '<!-- /abide:agent-guide -->'

/* The pointer injected into the consumer's root CLAUDE.md. Claude Code auto-loads
   root CLAUDE.md but never reads node_modules, so this is the only reliable hook
   telling it where abide's full surface map lives. */
const GUIDE_BLOCK = `${GUIDE_START}
## Working with abide

This project uses **abide**. Before using any abide API, read the complete surface
map: \`node_modules/@abide/abide/AGENTS.md\` — every export (import path + signature),
the file-based conventions, the CLI, env vars, and the \`.abide\` component grammar.
Open the source under \`node_modules/@abide/abide/src/lib/\` for depth.
${GUIDE_END}`

/* Folds the guide block into existing CLAUDE.md content: replaces a fenced block
   when both markers are present, otherwise appends it; titles a fresh file when
   there is no content. Pure — the side effect (write) stays in initAgent. */
function mergeGuide(existing: string | undefined): string {
    if (existing === undefined) {
        return `# Project guide for Claude\n\n${GUIDE_BLOCK}\n`
    }
    const start = existing.indexOf(GUIDE_START)
    const end = existing.indexOf(GUIDE_END)
    if (start !== -1 && end > start) {
        return existing.slice(0, start) + GUIDE_BLOCK + existing.slice(end + GUIDE_END.length)
    }
    return `${existing.replace(/\s*$/, '')}\n\n${GUIDE_BLOCK}\n`
}

/*
Writes (or refreshes) the abide agent-guide block in the project's root CLAUDE.md
so Claude is pointed at node_modules/@abide/abide/AGENTS.md. Idempotent: the marker
pair fences the block, so re-running updates it in place instead of duplicating, and
any surrounding CLAUDE.md content is preserved. For projects that added abide as a
dependency without scaffolding (the scaffold ships this pointer already).
*/
export async function initAgent({ cwd }: { cwd: string }): Promise<void> {
    const path = `${cwd}/CLAUDE.md`
    const file = Bun.file(path)
    const existed = await file.exists()
    await Bun.write(path, mergeGuide(existed ? await file.text() : undefined))
    console.log(
        existed
            ? `[abide] refreshed the abide agent-guide in ${path}`
            : `[abide] wrote ${path} pointing Claude at node_modules/@abide/abide/AGENTS.md`,
    )
}
