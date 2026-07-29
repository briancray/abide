// parseCliArgs(command, argv) — the flags of one subcommand → the single args object an RPC takes
// (machine-surfaces.md MS3.2).
//
// The schema is the parser: `--n 5` on a field typed `integer` arrives as the number 5, not "5", so a
// handler reading `n + 1` gets arithmetic rather than string concatenation. Where the schema says
// nothing (a type-derived read whose schema was never baked), a flag is coerced JSON-first and falls
// back to its literal string — the same permissive shape the flat query-param decoder uses, leaving
// the server's own validation as the arbiter.
//
// Errors are COLLECTED, not thrown: a wrong command line should report everything wrong with it in one
// pass rather than one item per attempt.

import { COERCE_FAILED, tryCoerceStringToType } from '../../shared/internal/jsonSchema.ts'
import type { CliCommand, CliCommandField } from './cliCommands.ts'

export interface ParsedCliArgs {
    args: Record<string, unknown>
    errors: string[]
}

// The whole-object escape hatch. Present on every command, so a caller holding JSON already (a script,
// a pipe, a shape the flag dialect cannot spell) never has to take it apart into flags.
const ARGS_FLAG = '--args'

// A value with no declared type: read it as JSON when it parses (numbers, booleans, null, arrays,
// objects), else keep the literal string. `--limit 5` should not become the string "5" just because the
// schema was not baked.
function looseValue(raw: string): unknown {
    try {
        return JSON.parse(raw)
    } catch {
        return raw
    }
}

function isFlag(token: string | undefined): boolean {
    return token === undefined ? false : token.startsWith('--')
}

export function parseCliArgs(command: CliCommand, argv: string[]): ParsedCliArgs {
    const byName = new Map<string, CliCommandField>()
    for (const field of command.fields) byName.set(field.name, field)

    const args: Record<string, unknown> = {}
    const errors: string[] = []
    // Which array-typed fields were built by REPEATING the flag, so a later `--tag b` appends to
    // `--tag a` instead of replacing it — while a single `--tags '["a","b"]'` still means the whole list.
    const accumulated = new Set<string>()

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index]
        if (token === undefined) continue

        if (!token.startsWith('--')) {
            errors.push(
                `unexpected argument "${token}" — ${command.name} takes flags (--field value), not positional arguments`,
            )
            continue
        }

        // `--flag=value` and `--flag value` are the same thing spelled two ways.
        const equals = token.indexOf('=')
        const name = (equals === -1 ? token : token.slice(0, equals)).slice(2)
        const inlineValue = equals === -1 ? undefined : token.slice(equals + 1)

        if (name === ARGS_FLAG.slice(2)) {
            const raw = inlineValue ?? argv[++index]
            if (raw === undefined) {
                errors.push(`${ARGS_FLAG} needs a JSON object`)
                continue
            }
            let parsed: unknown
            try {
                parsed = JSON.parse(raw)
            } catch {
                errors.push(`${ARGS_FLAG} is not valid JSON: ${raw}`)
                continue
            }
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                errors.push(`${ARGS_FLAG} must be a JSON object (an rpc takes one args object)`)
                continue
            }
            // Base object: flags on either side of it still win, so `--args '{"n":1}' --n 2` reads as
            // "this shape, but n is 2".
            Object.assign(args, parsed)
            continue
        }

        // `--no-flag` is the negative of a boolean field.
        if (name.startsWith('no-') && byName.get(name)?.type !== 'boolean') {
            const positive = name.slice(3)
            const field = byName.get(positive)
            if (field?.type === 'boolean' || (!command.schemaKnown && field === undefined)) {
                args[positive] = false
                continue
            }
        }

        const field = byName.get(name)
        if (field === undefined && command.schemaKnown) {
            errors.push(`unknown flag --${name} for ${command.name}`)
            // Swallow its value too. Left in place it would be read as a stray positional, and one
            // typo would report two unrelated errors.
            if (inlineValue === undefined && !isFlag(argv[index + 1])) index++
            continue
        }

        // A boolean field is a presence flag: `--verbose` means true. `--verbose false` still works,
        // so the value is only consumed when there IS one that isn't the next flag.
        const trailing = argv[index + 1]
        if (
            field?.type === 'boolean' &&
            inlineValue === undefined &&
            (trailing === undefined || isFlag(trailing))
        ) {
            args[name] = true
            continue
        }

        const raw = inlineValue ?? argv[++index]
        if (raw === undefined) {
            errors.push(`--${name} needs a value`)
            continue
        }

        if (field === undefined) {
            args[name] = looseValue(raw)
            continue
        }

        // An array field takes either spelling: one JSON array, or the flag repeated once per item.
        // Checked BEFORE coercion because a repeated `--tag a` is not JSON and must not read as a
        // malformed array.
        if (field.type === 'array') {
            const asList = tryCoerceStringToType(raw, 'array')
            if (Array.isArray(asList) && !accumulated.has(name)) {
                args[name] = asList
                continue
            }
            const existing = accumulated.has(name) ? (args[name] as unknown[]) : []
            existing.push(looseValue(raw))
            args[name] = existing
            accumulated.add(name)
            continue
        }

        const coerced = tryCoerceStringToType(raw, field.type)
        if (coerced === COERCE_FAILED) {
            errors.push(`--${name} expects ${field.type ?? 'a value'} — got "${raw}"`)
            continue
        }

        args[name] = coerced
    }

    for (const field of command.fields) {
        if (field.required && !(field.name in args)) {
            errors.push(`${command.name} requires --${field.name}`)
        }
    }

    return { args, errors }
}
