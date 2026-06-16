import { Glob } from 'bun'
import { abideLog } from './lib/shared/abideLog.ts'

const TEMPLATE_DIR = new URL('../template', import.meta.url).pathname
const OWN_PACKAGE_JSON = new URL('../package.json', import.meta.url).pathname

/*
Copies the bundled template directory into `${cwd}/${name}`, installs its
dependencies, and — when `dev` is set — starts the dev server in the new
project, so one command ends in a running app. A process can't change its
parent shell's cwd, so `cd` is printed as the step for when editing starts.
Refuses to write into a non-empty directory so an accidental run doesn't
overwrite real work. `install: false` (the `--no-install` flag) skips the
install — for CI flows that swap the dependency for a packed tarball before
installing, and offline scaffolds. An install *failure* doesn't fail the
scaffold: the tree is intact, so print `bun install` as a next step instead.
`dev` only fires after a successful install and holds until the server exits.
*/
export async function scaffold({
    cwd = process.cwd(),
    name,
    install = true,
    dev = false,
}: {
    cwd?: string
    name: string
    install?: boolean
    dev?: boolean
}): Promise<string> {
    const trimmed = name.trim()
    if (trimmed === '') {
        throw new Error('[abide] project name is required: bunx abide scaffold <name>')
    }
    const target = resolveTarget(cwd, trimmed)
    if (await targetIsNonEmpty(target)) {
        throw new Error(`[abide] target directory is not empty: ${target}`)
    }
    if (!(await Bun.file(`${TEMPLATE_DIR}/package.json`).exists())) {
        throw new Error(`[abide] template missing at ${TEMPLATE_DIR}`)
    }
    await copyTree(TEMPLATE_DIR, target)
    await pinAbideToOwnVersion(target)
    const installed = install ? await installDependencies(target) : false
    abideLog.success(`scaffolded abide project at ${target}`)
    if (target !== cwd) {
        abideLog.detail(`  to start editing: cd ${trimmed}`)
    }
    if (dev && installed) {
        await runDevServer(target)
        return target
    }
    abideLog.detail('  to run it:')
    if (!installed) {
        abideLog.detail('    bun install')
    }
    abideLog.detail('    bun run dev')
    return target
}

/* Runs `bun install` in the scaffolded project, streaming its output. */
async function installDependencies(target: string): Promise<boolean> {
    const proc = Bun.spawn(['bun', 'install'], {
        cwd: target,
        stdout: 'inherit',
        stderr: 'inherit',
    })
    if ((await proc.exited) === 0) {
        return true
    }
    abideLog.warn('bun install failed — run it yourself once the cause is fixed')
    return false
}

/* Starts the project's dev server (Ctrl-C stops it) and waits for it to exit. */
async function runDevServer(target: string): Promise<void> {
    abideLog.detail('  starting the dev server (Ctrl-C to stop)…')
    const proc = Bun.spawn(['bun', 'run', 'dev'], {
        cwd: target,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
    })
    await proc.exited
}

/*
Rewrites the scaffolded package.json so `abide` is pinned to the
version of the CLI that ran the scaffold. The template's static pin is only a
fallback — deriving the range at scaffold time means a stale template can
never install a framework version the docs don't describe.
*/
async function pinAbideToOwnVersion(target: string): Promise<void> {
    const { name, version } = await Bun.file(OWN_PACKAGE_JSON).json()
    const manifestFile = Bun.file(`${target}/package.json`)
    const manifest = await manifestFile.json()
    manifest.dependencies[name] = `^${version}`
    await Bun.write(manifestFile, `${JSON.stringify(manifest, undefined, 4)}\n`)
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
