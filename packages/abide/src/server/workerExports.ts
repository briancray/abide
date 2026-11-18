import { defaultsInSource } from '#shared/reactive/parameterDefaults.ts'
import type { WorkerExport } from '#shared/worker/WorkerMessage.ts'

const TRANSPILER = new Bun.Transpiler({ loader: 'ts' })

/**
 * Each export of the worker file `file`, whose source is `text`, to what its stand-in is built from —
 * or the refusal of the first that is no `async function` nor `async function*` declaration (55.3).
 *
 * READ OFF THE TRANSPILED MODULE, where a declaration is printed one way however it was written, and
 * a type, which has no value to call, is gone.
 */
export function workerExports(
    file: string,
    text: string,
): Record<string, WorkerExport> | Error {
    const module = TRANSPILER.transformSync(text)
    const exported: Record<string, WorkerExport> = {}
    for (const name of TRANSPILER.scan(module).exports) {
        const declared = new RegExp(
            `^export async function(\\*)? ${RegExp.escape(name)}\\(\\s*(\\)?)`,
            'm',
        ).exec(module)
        if (declared === null)
            return new Error(
                `abide: ${file} exports ${name}, and a worker file exports async functions and async generator functions alone, each declared where it is exported. RULEBOOK 55.3.`,
            )
        // 55.14 — the defaults 11.29 reads. One that is no literal is left out of the stand-in's,
        // whose own text carries none for 11.29 to refuse it by.
        let defaults: WorkerExport['defaults'] = null
        try {
            defaults = defaultsInSource(module.slice(declared.index))
        } catch {}
        exported[name] = {
            kind: declared[1] === '*' ? 'stream' : 'call',
            declares: declared[2] === '',
            defaults,
        }
    }
    return exported
}
