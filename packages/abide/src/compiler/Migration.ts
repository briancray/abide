// 38.198 — WHAT ONE RELEASE'S MIGRATION IS, as `abide upgrade` runs it: one shape for every migration,
// a rewrite of each file (`eachSource`) or of the app whole.

/** 38.226 — a line of the file being rewritten a migration changed the meaning of, left for the app to decide. */
export type Note = (line: string, message: string) => void

/** 38.226 — `Note` for a migration over the app whole, naming the file the line is in. */
export type AppNote = (path: string, line: string, message: string) => void

/**
 * One release's change to an app: the text of each file it changes, by path relative to the app, and
 * `null` for a file it moves away from. `read` answers what earlier migrations left of a file, and
 * `undefined` where there is none; `sources` is every file of the app's own its code is written in.
 */
export type Migration = {
    version: string
    migrate: (
        read: (path: string) => Promise<string | undefined>,
        sources: () => Promise<string[]>,
        note: AppNote,
        // 38.231 — a file it moves, so a note an earlier migration made of it names where it went.
        move: (from: string, to: string) => void,
    ) => Promise<Record<string, string | null>>
}
