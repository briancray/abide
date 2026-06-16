import { writeDts } from './writeDts.ts'

/*
Emits a `.d.ts` that augments abide's `AppHealthMap` interface with the app
health() hook's resolved return type, so the client `health()` read types
against the project's own hook (e.g. `health().authenticated`). Conditional
over `typeof import('../app.ts')` because the hook is optional — absent, the
fields resolve empty; a non-object return is ignored, matching the runtime
merge. With no src/app.ts at all the import would be an error, so the file
carries only the framework shape. Written to `src/.abide/health.d.ts` like
its routes/rpc siblings.
*/
export async function writeHealthDts({
    cwd,
    hasAppModule,
    importName,
}: {
    cwd: string
    hasAppModule: boolean
    importName: string
}): Promise<void> {
    const body = hasAppModule
        ? `type AppHealthFields<App> = App extends { health: (...args: never[]) => infer Result }
    ? Awaited<Result> extends object
        ? Awaited<Result>
        : Record<never, never>
    : Record<never, never>

declare module '${importName}/shared/health' {
    interface AppHealthMap {
        fields: AppHealthFields<typeof import('../app.ts')>
    }
}`
        : '// src/app.ts absent — health() carries only the framework fields.'
    await writeDts(cwd, 'health', body)
}
