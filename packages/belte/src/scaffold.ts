import { Glob } from 'bun'
import { log } from './lib/shared/log.ts'

const TEMPLATE_DIR = new URL('../template', import.meta.url).pathname

/*
Copies the bundled template directory into `${cwd}/${name}`. Refuses to write
into a non-empty directory so an accidental run doesn't overwrite real work.
*/
export async function scaffold({
    cwd = process.cwd(),
    name,
}: {
    cwd?: string
    name: string
}): Promise<string> {
    const trimmed = name.trim()
    if (trimmed === '') {
        throw new Error('[belte] project name is required: bunx belte scaffold <name>')
    }
    const target = resolveTarget(cwd, trimmed)
    if (await targetIsNonEmpty(target)) {
        throw new Error(`[belte] target directory is not empty: ${target}`)
    }
    if (!(await Bun.file(`${TEMPLATE_DIR}/package.json`).exists())) {
        throw new Error(`[belte] template missing at ${TEMPLATE_DIR}`)
    }
    await copyTree(TEMPLATE_DIR, target)
    log.success(`scaffolded belte project at ${target}`)
    log.detail('  next steps:')
    if (target !== cwd) {
        log.detail(`    cd ${trimmed}`)
    }
    log.detail('    bun install')
    log.detail('    bun run dev')
    return target
}

/*
Copies every file under `from` into `to`, preserving relative paths. Uses
Bun.Glob to enumerate (dotfiles included) and Bun.write to materialize each
file — Bun.write auto-creates parent directories.
*/
async function copyTree(from: string, to: string): Promise<void> {
    const files = await Array.fromAsync(
        new Glob('**/*').scan({ cwd: from, onlyFiles: true, dot: true }),
    )
    await Promise.all(
        files.map(async (relativePath) => {
            const source = Bun.file(`${from}/${relativePath}`)
            await Bun.write(`${to}/${relativePath}`, source)
        }),
    )
}

/*
Resolves the user-supplied name against the working directory. Absolute
paths (`/tmp/foo`) and `~`-prefixed paths are used as-is; relative names
are joined onto `cwd`.
*/
function resolveTarget(cwd: string, name: string): string {
    if (name === '.' || name === './') {
        return cwd
    }
    if (name.startsWith('/')) {
        return name
    }
    if (name.startsWith('~/')) {
        const home = process.env.HOME ?? ''
        return `${home}${name.slice(1)}`
    }
    return `${cwd}/${name}`
}

/*
True when the target exists and contains at least one entry. Uses Bun.Glob
rather than fs.readdir to honor the project's "Bun-first" rule. A missing
directory is reported as empty so first-time scaffolds proceed.
*/
async function targetIsNonEmpty(target: string): Promise<boolean> {
    try {
        for await (const _ of new Glob('*').scan({ cwd: target, onlyFiles: false, dot: true })) {
            return true
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false
        }
        throw error
    }
    return false
}
