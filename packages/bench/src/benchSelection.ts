// WHICH BENCHES TO RUN — the one selection vocabulary every runner shares (`run.ts`, `server.ts`,
// `gate.ts`, `delta.ts`), so one habit works across all four and a filter means the same thing everywhere.
//
//   bun run bench                        # everything (the default; unchanged)
//   bun run bench -- --list              # print the labels this runner can run, then exit
//   bun run bench -- for-list-1000       # bare patterns select
//   bun run bench:server -- memo route   # …several of them (union, not intersection)
//   bun run bench:delta -- --only=memo   # or --only=, for a runner whose positional means something else
//
// A LABEL is what the runner prints in its first column: a scenario name (`for-list-1000`) for the
// frontend corpus, `group/name` (`memo/read-warm`) for the server + reactive corpora.
//
// A PATTERN matches a label case-insensitively. With no `*` it is a SUBSTRING match — `memo` selects
// every `memo/*` bench and `list` every list scenario — because a label is a path and selecting a whole
// group is the common case. With a `*` it is anchored glob (`memo/*`, `list-*-1000`), for when substring
// is too broad.
//
// Selecting is a subset of the SAME work, not a different measurement: each bench keeps its own warmup
// and adaptive budget, so a filtered number is comparable to the same row from a full run.

export interface BenchSelection {
    // Empty = no filter: run everything.
    patterns: string[]
    // `--list`: the runner prints its labels and exits without measuring anything.
    list: boolean
    matches(label: string): boolean
    // The patterns that matched none of `labels` — a typo'd filter must be loud, not a silent empty run.
    unmatched(labels: string[]): string[]
}

export interface BenchSelectionOptions {
    // Accept bare non-flag argv entries as patterns. Off for a runner whose positional already means
    // something else (`bench:delta <ref>`), which then takes `--only=` only.
    positional?: boolean
}

const ONLY_PREFIX = '--only='

function addPatterns(patterns: string[], raw: string): void {
    for (const part of raw.split(',')) {
        const pattern = part.trim()
        if (pattern.length > 0) patterns.push(pattern)
    }
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Substring by default, anchored glob when the pattern carries a `*`. `label` arrives lowercased.
function toMatcher(pattern: string): (label: string) => boolean {
    const needle = pattern.toLowerCase()
    if (!needle.includes('*')) return (label) => label.includes(needle)
    const source = needle.split('*').map(escapeRegExp).join('.*')
    const expression = new RegExp(`^${source}$`)
    return (label) => expression.test(label)
}

export function benchSelection(argv: string[], opts?: BenchSelectionOptions): BenchSelection {
    const positional = opts?.positional ?? false
    const patterns: string[] = []
    let list = false
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? ''
        if (arg === '--list') {
            list = true
            continue
        }
        if (arg === '--only') {
            const next = argv[i + 1]
            if (next === undefined)
                throw new Error('--only needs a comma-separated list of patterns')
            addPatterns(patterns, next)
            i++
            continue
        }
        if (arg.startsWith(ONLY_PREFIX)) {
            addPatterns(patterns, arg.slice(ONLY_PREFIX.length))
            continue
        }
        if (arg.startsWith('-')) continue
        if (positional) addPatterns(patterns, arg)
    }

    const matchers = patterns.map(toMatcher)
    return {
        patterns,
        list,
        matches(label: string): boolean {
            if (matchers.length === 0) return true
            const lowered = label.toLowerCase()
            for (const matcher of matchers) if (matcher(lowered)) return true
            return false
        },
        unmatched(labels: string[]): string[] {
            const lowered = labels.map((label) => label.toLowerCase())
            const missed: string[] = []
            for (let i = 0; i < matchers.length; i++) {
                const matcher = matchers[i]
                if (matcher === undefined) continue
                if (!lowered.some(matcher)) missed.push(patterns[i] ?? '')
            }
            return missed
        },
    }
}
