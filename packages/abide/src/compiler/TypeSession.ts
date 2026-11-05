import type { CompletionInfo } from 'typescript/unstable/async'

import type { AppLayout } from './appLayout.ts'
import { appLints } from './appLints.ts'
import { type CheckerAnswer, UNCHECKED } from './CheckerAnswer.ts'
import { type DiagnosedSource, diagnoseSources } from './diagnoseSources.ts'
import type { Diagnosis } from './Diagnostics.ts'
import {
    completionAt,
    type Inspection,
    type LoweredFile,
    type References,
} from './LoweredFile.ts'
import type { AbideFile } from './parseAbide.ts'
import { reactiveReads } from './reactiveReads.ts'
import type { ParsedSource } from './readSources.ts'
import { ShadowHost } from './ShadowHost.ts'

// Where 31.3 gets its answer: TypeScript's own checker, asked about an app's `.abide` files through
// the shadows a `ShadowHost` holds for it. That is the whole reason the checker is here rather than
// a local inference over annotations: the corpus writes `let rows = reactive([...])` with no
// annotation anywhere, so the answer comes from the initializer's INFERRED type or it does not come
// at all.
//
// ONE OBJECT FOR WHAT A BUILD, A CHECK AND AN EDITOR ASK, each question answered by the module that
// owns it — the reads (`reactiveReads`), the lints (`appLints`), the diagnosis (`diagnoseSources`)
// and an editor's questions of a file's lowering (`LoweredFile`) — over the one host.

/** A TypeScript checker session over an app, asked about its `.abide` files through shadows. */
export class TypeSession {
    /** The checker, the files it reads out of this session, and the snapshots it holds of them. */
    readonly host: ShadowHost

    private constructor(host: ShadowHost) {
        this.host = host
    }

    /**
     * Opens a session on the project `tsconfig` configures, for the app at `root` — real, and empty
     * for a session asked about no app's routes.
     */
    static async open(tsconfig: string, root = ''): Promise<TypeSession> {
        return new TypeSession(await ShadowHost.open(tsconfig, root))
    }

    /** The `tsconfig` the session was opened on, which a file outside its project is refused by. */
    get tsconfig(): string {
        return this.host.tsconfig
    }

    /** The app's root, real. */
    get root(): string {
        return this.host.root
    }

    /** How many snapshots this session has taken (`ShadowHost.snapshots`). */
    get snapshots(): number {
        return this.host.snapshots
    }

    /** `path` below the app's root, where it lies under it (23.14). */
    belowRoot(path: string): string {
        return this.host.belowRoot(path)
    }

    /** Records the paths a watcher saw move, for the next snapshot to invalidate. */
    edited(paths: string[] | undefined): void {
        this.host.edited(paths)
    }

    /**
     * The classified reactive reads in one `.abide` file.
     *
     * ONE FILE; a build wants `readsFor`.
     */
    async reads(abidePath: string, file: AbideFile): Promise<CheckerAnswer> {
        const answered = await this.readsFor([{ path: abidePath, file }])
        return answered.answers[0] ?? UNCHECKED
    }

    /** Reads and compiler warnings for every file, in one checker snapshot (`reactiveReads`). */
    readsFor(
        sources: readonly (Pick<ParsedSource, 'path' | 'file'> & {
            text?: string
        })[],
    ): Promise<{ answers: CheckerAnswer[]; warnings: Diagnosis[] }> {
        return reactiveReads(this.host, sources)
    }

    /** What the build refuses and warns on in the app's `.ts` and `.abide` files (`appLints`). */
    lints(
        within: string,
        sources: readonly Omit<ParsedSource, 'quiet'>[],
        scripts = true,
    ): Promise<{ ambient: Diagnosis[]; unkeyed: Diagnosis[] }> {
        return appLints(this.host, within, sources, scripts)
    }

    /**
     * The checker's diagnostics for each `.abide` source and the app's `.ts` roots, and each
     * source's lowering (`diagnoseSources`).
     */
    diagnose(
        sources: readonly DiagnosedSource[],
        app: Pick<AppLayout, 'root' | 'addresses' | 'handlers' | 'routes'>,
        scripts = true,
    ): Promise<{
        diagnoses: Diagnosis[]
        refused: Set<string>
        lowered: LoweredFile[]
    }> {
        return diagnoseSources(this.host, sources, app, scripts)
    }

    /** The lowering a diagnosis last registered for the `.abide` at `path`, whatever its text. */
    lowered(path: string): LoweredFile | undefined {
        return this.host.lowered(path)
    }

    /** The members or markup that may be written at `offset` in a `.abide` (`completionAt`). */
    complete(
        path: string,
        text: string,
        offset: number,
        triggerCharacter?: string,
    ): Promise<CompletionInfo | undefined> {
        return completionAt(this.lowered(path), text, offset, triggerCharacter)
    }

    /** The name at `offset` in a `.abide` as its last lowering holds it (`LoweredFile.inspect`). */
    async inspect(
        path: string,
        text: string,
        offset: number,
    ): Promise<Inspection | undefined> {
        return this.lowered(path)?.inspect(text, offset)
    }

    /** Every place the name at `offset` in a `.abide` is written (`LoweredFile.references`). */
    async references(
        path: string,
        text: string,
        offset: number,
    ): Promise<References | undefined> {
        return this.lowered(path)?.references(text, offset)
    }

    /** Closes the checker, and ends its process. */
    close(): Promise<void> {
        return this.host.close()
    }
}
