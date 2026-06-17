import { messageFromError } from './messageFromError.ts'

/*
True when an error from a dynamic `import(...)` is a module-resolution
failure (the package isn't installed) rather than an error thrown while
the module's own code ran. Lets optional-peer loads swallow "not installed"
while letting a genuine load-time failure surface. Bun surfaces the former
as a ResolveMessage / ERR_MODULE_NOT_FOUND; the message check is the
cross-runtime fallback.
*/
export function isModuleNotFound(error: unknown): boolean {
    const code = (error as { code?: string })?.code
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
        return true
    }
    const message = messageFromError(error)
    return /cannot find (module|package)|failed to resolve/i.test(message)
}
