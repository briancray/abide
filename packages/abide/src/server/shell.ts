// 38.7 — THE SHELL AGAINST A RUNNING APP, the one served here or the one `--url` names: a line is a
// command, read with readline in a terminal's `LogPanel` or off a pipe, and what it lists, completes
// and suggests is derived from the handler table alone — so all of that is pure, and the loop below
// is the only part that needs a terminal. A call goes over http through `remote.ts`, as any client's.

import { createInterface } from 'node:readline' // bun exposes no line editor of its own
import { isRecord } from '#shared/isRecord.ts'
import { useColor } from '#shared/log.ts'
import { paint as painted } from '#shared/paint.ts'
import type { Mount } from './answerRpc.ts'
import { LogPanel } from './LogPanel.ts'
import { callHandler, watch } from './remote.ts'
import { type Listed, surfaceOf } from './surfaceOf.ts'

/**
 * A shell line's words: split on whitespace, a quoted run kept whole and its quotes dropped — so
 * `note="two words"` is one word, as a POSIX shell reads it.
 */
function wordsOf(text: string): string[] {
    const words: string[] = []
    let word = ''
    let quote = ''
    let started = false
    for (const character of text) {
        if (quote !== '') {
            if (character === quote) quote = ''
            else word += character
        } else if (character === '"' || character === "'") {
            quote = character
            started = true
        } else if (/\s/.test(character)) {
            if (started) words.push(word)
            word = ''
            started = false
        } else {
            word += character
            started = true
        }
    }
    if (started) words.push(word)
    return words
}

/**
 * Runs the interactive shell against a running app until `exit` or the end of input.
 *
 * 38.7 — THE SHELL AGAINST A RUNNING APP: a line is a command, and `call` is the same spelling it
 * is in argv (38.8). Answers `exit` where the line said so and `ended` where the input did, so a
 * host that owns the app can stop it on the one and keep serving on the other.
 *
 * `local` is the app in this process — the one `abide` alone serves — whose `exit` stops it.
 */
export async function shell(options: {
    url: string
    handlers: Mount[]
    heading: string
    local: boolean
}): Promise<'exit' | 'ended'> {
    const { url, handlers, local } = options
    const words = shellWords(local)
    const listed = cliListing(handlers)
    // A PROMPT IS FOR A TERMINAL. Input piped in is answered without one, and a process whose output
    // nobody reads — a container's, a test's — is not written to until there is an answer to write.
    const terminal =
        process.stdin.isTTY === true && process.stdout.isTTY === true
    const color = useColor()
    const paint = (code: string, text: string): string =>
        painted(color, code, text)
    const lines = createInterface({
        input: process.stdin,
        output: terminal ? process.stdout : undefined,
        terminal,
        prompt: `${paint('1;36', '›')} `,
        completer: (line: string) =>
            completed(line, words, listed, (hits) =>
                panel?.showCompletions(hits),
            ),
    })
    // CTRL-C AS A SHELL TAKES IT — raw mode takes the key from the terminal, so no signal is sent for
    // it: a call running is canceled, then every watch standing, a line typed is dropped, and on
    // an empty line it asks once and leaves on the second, as `node`'s REPL does.
    let exited = false
    let closed = false
    let running: AbortController | undefined
    const watching = new Set<AbortController>()
    let leaving = false
    lines.on('SIGINT', () => {
        if (running !== undefined) running.abort()
        else if (watching.size !== 0) {
            for (const each of watching) each.abort()
            watching.clear()
            console.log('(watches stopped)')
        } else if (lines.line !== '') {
            lines.write(null, { ctrl: true, name: 'e' })
            lines.write(null, { ctrl: true, name: 'u' })
        } else if (leaving) {
            exited = true
            lines.close()
        } else {
            leaving = true
            console.log(
                `(Ctrl+C again ${local ? 'stops the app' : 'leaves'}, as exit does)`,
            )
        }
    })
    lines.on('close', () => {
        closed = true
    })
    // THE COMPLETION TAB WOULD MAKE, in gray after the line — or, where there is none, what the line
    // expects next, dim and italic, since Tab will not write it. Written after readline has handled
    // the key, and the row cleared past the line first, since readline echoes a typed character
    // without redrawing the rest of the row. Shown only with the cursor at the end. The divider says
    // the handler's args for as long as the line calls one, so they stay in sight while typed.
    let panel: LogPanel | undefined
    const suggest = (): void => {
        if (closed) return
        const line = lines.line
        const handler = handlerCalled(line, listed)
        panel?.setSignature(
            handler === undefined
                ? undefined
                : `${handler.path} ${argsText(handler.schema)}${handler.description === undefined ? '' : ` — ${handler.description}`}`,
        )
        // Past the end of what is typed, wherever the cursor stands in it, so only the gray is cleared.
        const after = line.length - lines.cursor
        let ghost = ''
        let width = 0
        if (after === 0 && line.trim() !== '') {
            const { typed, common } = completionOf(line, words, listed)
            const rest = common.slice(typed.length)
            const expected =
                rest === '' ? expectedAfter(line, words, handler) : ''
            width = rest.length + expected.length
            ghost =
                rest !== ''
                    ? paint('90', rest)
                    : expected !== ''
                      ? paint('2;3', expected)
                      : ''
        }
        const back = after + width
        process.stdout.write(
            `${after > 0 ? `\x1b[${after}C` : ''}\x1b[K${ghost}${back > 0 ? `\x1b[${back}D` : ''}`,
        )
    }
    // Any key but Tab takes the listed completions away: what they listed no longer answers the line.
    // Ctrl+L is readline's clear, which knows nothing of the panel, so the panel is emptied after it.
    const keyed = (
        _: string,
        key: { name?: string; ctrl?: boolean } | undefined,
    ): void => {
        if (!(key?.ctrl === true && key.name === 'c')) leaving = false
        if (key?.ctrl === true && key.name === 'l') panel?.clear()
        else if (key?.name !== 'tab') panel?.hideCompletions()
        suggest()
    }
    if (terminal) process.stdin.on('keypress', keyed)
    // Assigned once built: the constructor draws the prompt, and that asks `suggest`, which reads it.
    panel = terminal
        ? new LogPanel(
              options.heading,
              `help for commands · tab completes · exit to ${local ? 'stop the app' : 'leave'}`,
              () => {
                  if (closed) return
                  lines.prompt(true)
                  suggest()
              },
          )
        : undefined
    if (panel === undefined) console.log(options.heading)
    try {
        for await (const line of lines) {
            const [word, address] = line.trim().split(/\s+/)
            const restOfLine = line.trim().replace(/^\S+\s+\S+\s*/, '')
            if (word === undefined || word === '') {
                panel?.prompt()
                continue
            }
            panel?.write(paint('2', `› ${line.trim()}`))
            if (word === 'exit' || word === 'quit') return 'exit'
            if (word === 'help') console.log(helpText(words))
            else if (word === 'handlers')
                console.log(handlersText(listed, paint))
            else if (word === 'call' && address !== undefined) {
                running = new AbortController()
                const answered = await callHandler(
                    url,
                    address,
                    // A JSON object is the rest of the line as typed; `name=value` words are read
                    // as a shell reads them, quotes and all.
                    restOfLine.startsWith('{')
                        ? [restOfLine]
                        : wordsOf(restOfLine),
                    undefined,
                    handlers,
                    running.signal,
                ).catch((thrown: Error) => ({
                    code: 1,
                    text: running?.signal.aborted
                        ? '(canceled)'
                        : thrown.message,
                }))
                running = undefined
                console.log(
                    answered.text === ''
                        ? `(${answered.code === 0 ? 'no content' : `exit ${answered.code}`})`
                        : answered.text,
                )
            } else if (word === 'call')
                console.log('call: name the handler — call <address> [args]')
            // FOLLOWED ALONGSIDE THE PROMPT rather than in place of it, so the shell still answers.
            else if (word === 'watch' && address !== undefined) {
                const following = new AbortController()
                watching.add(following)
                void watch(
                    url,
                    address,
                    restOfLine.startsWith('{')
                        ? [restOfLine]
                        : wordsOf(restOfLine),
                    following.signal,
                )
                    .catch((thrown: Error) => {
                        if (!following.signal.aborted)
                            console.log(`watch: ${thrown.message}`)
                    })
                    .finally(() => watching.delete(following))
            } else if (word === 'watch')
                console.log('watch: name a GET — watch <address> [args]')
            else
                console.log(
                    `unknown: ${word} — help lists what the shell takes`,
                )
            panel?.prompt()
        }
        return exited ? 'exit' : 'ended'
    } finally {
        process.stdin.off('keypress', keyed)
        lines.close()
        panel?.close()
    }
}

/**
 * What Tab completes `line` to: the words it could be — a shell word, a handler address after `call`,
 * or one of that handler's arg names not given yet — the part of the line they complete, and the
 * longest prefix they share.
 */
export function completionOf(
    line: string,
    words: [string, string][],
    listed: Listed[],
): { hits: string[]; typed: string; common: string } {
    const calling = /^\s*call\s+(\S*)$/.exec(line)
    const naming = /^\s*call\s+(\S+)\s+(?:.*\s)?([^\s=]*)$/.exec(line)
    let typed = line.trimStart()
    const hits: string[] = []
    if (calling !== null) {
        typed = calling[1] as string
        for (const { path } of listed)
            if (path.startsWith(typed)) hits.push(path)
    } else if (naming !== null) {
        typed = naming[2] as string
        for (const name of argsLeft(line, handlerCalled(line, listed)))
            if (name.startsWith(typed)) hits.push(`${name}=`)
    } else if (!typed.includes(' '))
        for (const [usage] of words) {
            const word = usage.split(' ')[0] as string
            if (word.startsWith(typed)) hits.push(word)
        }
    let common = hits[0] ?? typed
    for (const hit of hits)
        while (!hit.startsWith(common)) common = common.slice(0, -1)
    return { hits, typed, common }
}

/** The listed handler `line` calls, where it names one. */
function handlerCalled(line: string, listed: Listed[]): Listed | undefined {
    const called = /^\s*call\s+(\S+)/.exec(line)?.[1]
    if (called === undefined) return undefined
    return listed.find((one) => one.path === called)
}

/** The arg names `handler` declares that `line` has not given yet — none where its args are JSON. */
function argsLeft(line: string, handler: Listed | undefined): string[] {
    const properties = flatProperties(handler?.schema)
    if (properties === undefined || /^\s*call\s+\S+\s+\{/.test(line)) return []
    const left: string[] = []
    for (const name of Object.keys(properties))
        if (!new RegExp(`(^|\\s)${RegExp.escape(name)}=`).test(line))
            left.push(name)
    return left
}

/**
 * A handler's args properties where each is one `name=value` word can spell — a scalar, or a list
 * of them — or `undefined` where the args are some other shape, and JSON is how they are typed.
 */
function flatProperties(schema: unknown): Record<string, unknown> | undefined {
    if (!isRecord(schema) || !isRecord(schema.properties)) return undefined
    for (const property of Object.values(schema.properties)) {
        const member =
            isRecord(property) && property.type === 'array'
                ? property.items
                : property
        if (
            !isRecord(member) ||
            member.type === 'object' ||
            isRecord(member.properties)
        )
            return undefined
    }
    return schema.properties
}

/**
 * Readline's completion of `line`.
 *
 * SEVERAL CANDIDATES ARE HANDED TO `list`, and readline only their common prefix: its own listing
 * writes newlines from the prompt's row, which scroll the panel's layout away.
 */
function completed(
    line: string,
    words: [string, string][],
    listed: Listed[],
    list: (hits: string[]) => void,
): [string[], string] {
    const { hits, typed, common } = completionOf(line, words, listed)
    if (hits.length < 2) return [hits, typed]
    list(hits)
    return [common.length > typed.length ? [common] : [], typed]
}

/**
 * The placeholder for what `line` expects next: the rest of a shell word's usage once the word is
 * typed, and once a handler's address is, the args it declares that the line has not given.
 */
export function expectedAfter(
    line: string,
    words: [string, string][],
    handler: Listed | undefined,
): string {
    const space = /\s$/.test(line) ? '' : ' '
    if (handler !== undefined) {
        if (/^\s*call\s+\S+\s*$/.test(line))
            return `${space}${argsText(handler.schema)}`
        const properties = flatProperties(handler.schema)
        if (properties === undefined) return ''
        // An arg named and not yet given a value expects the value; the next arg waits for a space.
        const naming = /\s([^\s=]+)=$/.exec(line)?.[1]
        if (naming !== undefined) {
            const value = argWord(naming, properties[naming], true)
            return value.slice(naming.length + 1)
        }
        if (space !== '') return ''
        const required = requiredOf(handler.schema)
        const left: string[] = []
        for (const name of argsLeft(line, handler))
            left.push(argWord(name, properties[name], required.includes(name)))
        return left.join(' ')
    }
    const word = /^\s*(\S+)\s*$/.exec(line)?.[1]
    for (const [usage] of words) {
        const [name, ...rest] = usage.split(' ')
        if (name === word && rest.length > 0) return `${space}${rest.join(' ')}`
    }
    return ''
}

/**
 * A handler's args as they are typed: `id=<string> [limit=<number>]`, or the JSON object where one
 * `name=value` word per arg cannot spell them.
 */
export function argsText(schema: unknown): string {
    if (schema === undefined) return 'no args'
    const properties = flatProperties(schema)
    if (properties === undefined) return schemaText(schema, 0)
    const required = requiredOf(schema)
    const typed: string[] = []
    for (const [name, property] of Object.entries(properties))
        typed.push(argWord(name, property, required.includes(name)))
    return typed.join(' ')
}

function requiredOf(schema: unknown): unknown[] {
    return isRecord(schema) && Array.isArray(schema.required)
        ? schema.required
        : []
}

/** One arg as its word: `limit=<number>`, a list's `tag=<string>…`, and `[…]` around an optional. */
function argWord(name: string, property: unknown, required: boolean): string {
    const list = isRecord(property) && property.type === 'array'
    const member = list && isRecord(property) ? property.items : property
    const value =
        isRecord(member) && Array.isArray(member.enum)
            ? member.enum.join('|')
            : `<${schemaText(member, 1)}>`
    const word = `${name}=${value}${list ? '…' : ''}`
    return required ? word : `[${word}]`
}

function schemaText(schema: unknown, depth: number): string {
    if (!isRecord(schema)) return 'unknown'
    if ('const' in schema) return JSON.stringify(schema.const)
    if (Array.isArray(schema.enum))
        return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
    const union = schema.anyOf ?? schema.oneOf
    if (Array.isArray(union))
        return union.map((member) => schemaText(member, depth)).join(' | ')
    const type = schema.type
    if (Array.isArray(type))
        return type
            .map((each) => schemaText({ ...schema, type: each }, depth))
            .join(' | ')
    if (type === 'object' || isRecord(schema.properties)) {
        if (depth > 1) return '{…}'
        const properties = isRecord(schema.properties) ? schema.properties : {}
        const required = requiredOf(schema)
        const fields: string[] = []
        for (const [key, value] of Object.entries(properties))
            fields.push(
                `"${key}"${required.includes(key) ? '' : '?'}: ${schemaText(value, depth + 1)}`,
            )
        return `{${fields.join(', ')}}`
    }
    if (type === 'array') {
        const item = schemaText(schema.items, depth + 1)
        return `${item.includes(' | ') ? `(${item})` : item}[]`
    }
    if (type === 'integer') return 'number'
    return typeof type === 'string' ? type : 'unknown'
}

/** What the shell takes: each word's usage, and what it does. */
export function shellWords(local: boolean): [usage: string, meaning: string][] {
    const words: [string, string][] = [
        [
            'call <address> [args]',
            'call a handler — call invoices/getInvoice id=4310',
        ],
        ['handlers', 'every handler call can reach, with its args'],
        ['watch <address> [args]', 'follow a GET — watch chat/room room=lobby'],
    ]
    words.push(
        ['help', 'this list — Ctrl+C clears the line, Ctrl+L the panel'],
        ['exit', local ? 'stop the app and leave' : 'leave the shell'],
    )
    return words
}

function helpText(words: [string, string][]): string {
    let width = 0
    for (const [usage] of words) width = Math.max(width, usage.length)
    let text = ''
    for (const [usage, meaning] of words)
        text += `${text === '' ? '' : '\n'}  ${usage.padEnd(width)}  ${meaning}`
    return text
}

/**
 * The handlers the shell lists, in the table's order: each one `call` reaches that does not withhold
 * itself from the command line (`surfaceOf`). 20.3 — `call` still reaches every one.
 */
export function cliListing(handlers: Mount[]): Listed[] {
    const listed: Listed[] = []
    for (const mount of handlers) {
        const one = surfaceOf(mount, 'cli')
        if (one !== undefined) listed.push(one)
    }
    return listed
}

/**
 * The handlers the shell lists: each address with the args it is typed with, and its description on
 * the line under it where it declares one. 38.62.
 */
export function handlersText(
    listed: Listed[],
    paint: (code: string, text: string) => string,
): string {
    let width = 0
    for (const { path } of listed) width = Math.max(width, path.length)
    let text = ''
    for (const { path, schema, description } of listed) {
        text += `${text === '' ? '' : '\n'}  ${path.padEnd(width)}  ${paint('2', argsText(schema))}`
        if (description !== undefined)
            text += `\n  ${' '.repeat(width)}  ${description}`
    }
    return text === '' ? '  no handlers in this build' : text
}
