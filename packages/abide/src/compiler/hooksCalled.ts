import { tokenize } from './tokenize.ts'

/** Every hook abide exports, by name. */
export const HOOK_NAMES: ReadonlySet<string> = new Set([
    'middleware',
    'onStart',
    'onStop',
    'onError',
    'onConfig',
    'onHealth',
    'onPrincipal',
    'onLauncher',
    'onMenu',
])

/**
 * Each of abide's hook names called in `source`, in the order written: the name, then `(`, and not
 * a declaration — a member call included, since `server.onStart(…)` is abide's hook all the same.
 * Read, not run — what `abide routes` lists and the build's refusals of a hook called where it is
 * never read (38.107) go by.
 */
export function hooksCalled(source: string): string[] {
    const called: string[] = []
    let previous = ''
    let named: string | undefined
    for (const token of tokenize(source)) {
        if (named !== undefined && token.text === '(') called.push(named)
        named =
            HOOK_NAMES.has(token.text) && previous !== 'function'
                ? token.text
                : undefined
        previous = token.text
    }
    return called
}
