import type { Origin, Span } from './projectShadow.ts'

/** What a `.abide`'s checked module is registered with the checker as, beside the `.abide`. */
export const CHECKED_SUFFIX = '.check.ts'
/** What a `.abide`'s projection is registered with the checker as, beside the `.abide`. */
export const SHADOW_SUFFIX = '.shadow.ts'

/**
 * The two files the checker reads for one `.abide`, and how a position in either is one in it.
 *
 * TWO LAYERS, ONE OVER THE OTHER. The projection (`projectShadow`) places each run it copied in the
 * `.abide`; the checked module (`checkedShadow`) places each of its own in the projection. A position
 * the checker reports in the checked module goes back through both, one in the projection through
 * the first alone — and which one a position is in is the file the checker named, so the map owns
 * the two suffixes as well as the two `origins`.
 *
 * Built over the projection alone where nothing has been lowered yet (`TypeSession.classify`), and
 * over both once it has.
 */
export class ShadowMap {
    /** The canonical `.abide` path. */
    readonly abidePath: string
    /** The projection's path, as the checker reads it. */
    readonly shadowPath: string
    /** The checked module's path, as the checker reads it. */
    readonly checkedPath: string
    private readonly projected: readonly Origin[]
    private readonly checked: readonly Origin[]

    constructor(
        abidePath: string,
        projected: readonly Origin[],
        checked: readonly Origin[] = [],
    ) {
        this.abidePath = abidePath
        this.shadowPath = `${abidePath}${SHADOW_SUFFIX}`
        this.checkedPath = `${abidePath}${CHECKED_SUFFIX}`
        this.projected = projected
        this.checked = checked
    }

    /** The `.abide` a file the checker reads stands for, or `undefined` where it stands for none. */
    static fileFor(path: string): string | undefined {
        for (const suffix of [CHECKED_SUFFIX, SHADOW_SUFFIX])
            if (path.endsWith(`.abide${suffix}`))
                return path.slice(0, -suffix.length)
        return undefined
    }

    /** Whether `path` is one of the files the checker reads for the `.abide` at `abidePath`. */
    static isShadowOf(path: string, abidePath: string): boolean {
        return (
            path === `${abidePath}${SHADOW_SUFFIX}` ||
            path === `${abidePath}${CHECKED_SUFFIX}`
        )
    }

    /**
     * Where `position` in `path` came from in the `.abide`. A position in scaffolding is placed at
     * the end of the run before it, which is the source the scaffolding was written for.
     */
    toSource(path: string, position: number): number {
        return mapBack(
            this.projected,
            path === this.checkedPath
                ? mapBack(this.checked, position)
                : position,
        )
    }

    /**
     * `start` to `end` in `path`, placed in the `.abide`, or `undefined` where it starts in what the
     * checked module added — a declaration of the lowering's own, which the author never wrote.
     */
    spanToSource(path: string, start: number, end: number): Span | undefined {
        if (
            path === this.checkedPath &&
            copiedFrom(this.checked, start) === undefined
        )
            return undefined
        return {
            start: this.toSource(path, start),
            end: this.toSource(path, end),
        }
    }

    /**
     * Where the author's `position` stands in what the checker reads: the checked module where the
     * lowering copied it, the projection where it rewrote it, `undefined` where nothing copied it.
     */
    fromSource(
        position: number,
    ): { path: string; position: number } | undefined {
        const projected = mapForward(this.projected, position)
        if (projected === undefined) return undefined
        const checked = mapForward(this.checked, projected)
        return checked === undefined
            ? { path: this.shadowPath, position: projected }
            : { path: this.checkedPath, position: checked }
    }

    /**
     * EVERY place the checker reads the author's `position` at: the projection where it copied it,
     * and the checked module too wherever the lowering copied it on — a component's props type is
     * a second copy (38.116). A name read by name is a rewrite in the checked module, so its uses
     * there are another symbol's — the projection's holds them.
     */
    placesFrom(position: number): { path: string; position: number }[] {
        const projected = mapForward(this.projected, position)
        if (projected === undefined) return []
        const places = [{ path: this.shadowPath, position: projected }]
        for (const origin of this.checked)
            if (
                projected >= origin.source &&
                projected < origin.source + origin.length
            )
                places.push({
                    path: this.checkedPath,
                    position: origin.at + projected - origin.source,
                })
        return places
    }

    /**
     * `start` to `end` in `path`, placed in the `.abide` only where BOTH layers copied it from what
     * the author wrote — the strict `spanToSource`, for an edit that must land on the author's text.
     */
    copiedToSource(path: string, start: number, end: number): Span | undefined {
        let projected: number | undefined = start
        if (path === this.checkedPath)
            projected = copiedFrom(this.checked, start)
        if (projected === undefined) return undefined
        const source = copiedFrom(this.projected, projected)
        return source === undefined
            ? undefined
            : { start: source, end: source + end - start }
    }
}

/** The start of the run holding `position`, plus how far in; scaffolding is the run before's end. */
export function mapBack(origins: readonly Origin[], position: number): number {
    let low = 0
    let high = origins.length
    while (low < high) {
        const middle = (low + high) >>> 1
        if ((origins[middle] as Origin).at <= position) low = middle + 1
        else high = middle
    }
    const origin = origins[low - 1]
    if (origin === undefined) return 0
    return origin.source + Math.min(position - origin.at, origin.length)
}

/** The strict `mapBack`: where the run holding `position` was copied from, or `undefined`. */
function copiedFrom(
    origins: readonly Origin[],
    position: number,
): number | undefined {
    for (const origin of origins)
        if (position >= origin.at && position < origin.at + origin.length)
            return origin.source + position - origin.at
    return undefined
}

/**
 * Where the run copied from source `position` stands, or `undefined` where nothing copied it —
 * markup, or a read the lowering rewrote. Runs are ascending by where they stand, not by where they
 * came from, so this is a scan.
 */
export function mapForward(
    origins: readonly Origin[],
    position: number,
): number | undefined {
    for (const origin of origins)
        if (
            position >= origin.source &&
            position < origin.source + origin.length
        )
            return origin.at + position - origin.source
    return undefined
}
