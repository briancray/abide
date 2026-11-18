// 55.1 — EVERY WORKER FILE, BUILT AS THE ENTRY OF A THREAD: the file, and `serveWorker` answering
// its calls. Built AHEAD of the bundle importing it, so that bundle's stand-ins can name what each
// one was written to (`workerFilesPlugin`) — the browser's bundle, and an executable's.
//
// 55.10 — NO STAND-INS HERE: `workerFilesPlugin` is not among the plugins, so a worker file one of
// these imports is bundled as the module it is, as a server started from its sources loads it.

import { dirname } from 'node:path' // bun exposes no path helpers of its own

import { WORKER_SPECIFIER } from '#shared/SPECIFIERS.ts'

const ENTRY_SUFFIX = '.abide-worker-entry'
const ENTRY_NAMESPACE = 'abide-worker-entry'

/** What `workerBundles` built: each worker file's absolute path to the name its entry was written under. */
type WorkerBuild = {
    names: Map<string, string>
    outputs: Bun.BuildArtifact[]
}

/**
 * Each worker file in `files`, by absolute path, built below `root` by `config` — its target, its
 * plugins and where it writes. A build that fails throws, its logs the error's.
 */
export async function workerBundles(
    root: string,
    files: readonly string[],
    config: Omit<
        Bun.BuildConfig,
        'entrypoints' | 'root' | 'naming' | 'metafile' | 'throw'
    >,
): Promise<WorkerBuild> {
    const build: WorkerBuild = { names: new Map(), outputs: [] }
    if (files.length === 0) return build
    const built = await Bun.build({
        ...config,
        // Named `<name>.worker` after the file, before the build's hash.
        entrypoints: files.map(
            (file) => `${file.slice(0, -'.ts'.length)}${ENTRY_SUFFIX}`,
        ),
        root,
        naming: '[name]-[hash].[ext]',
        metafile: true,
        throw: false,
        plugins: [
            {
                name: 'abide-worker-entries',
                setup(entries) {
                    entries.onResolve(
                        {
                            filter: new RegExp(
                                `${RegExp.escape(ENTRY_SUFFIX)}$`,
                            ),
                        },
                        (args) => ({
                            path: args.path,
                            namespace: ENTRY_NAMESPACE,
                        }),
                    )
                    entries.onLoad(
                        { filter: /.*/, namespace: ENTRY_NAMESPACE },
                        (args) => {
                            const file = workerFileOf(args.path)
                            return {
                                contents: `import * as module from ${JSON.stringify(file)}\nimport { serveWorker } from '${WORKER_SPECIFIER}'\nserveWorker(module)\n`,
                                loader: 'js',
                                // So the framework resolves from the app, as the file's own imports do.
                                resolveDir: dirname(file),
                            }
                        },
                    )
                },
            },
            ...(config.plugins ?? []),
        ],
    })
    if (!built.success)
        throw new AggregateError(
            built.logs,
            'abide: a worker file failed to build',
        )
    build.outputs = built.outputs
    const outputs = (built.metafile as Bun.BuildMetafile).outputs
    for (const [output, { entryPoint }] of Object.entries(outputs))
        if (entryPoint !== undefined)
            build.names.set(
                workerFileOf(entryPoint.slice(entryPoint.indexOf(':') + 1)),
                output.slice(output.lastIndexOf('/') + 1),
            )
    return build
}

function workerFileOf(entry: string): string {
    return `${entry.slice(0, -ENTRY_SUFFIX.length)}.ts`
}
