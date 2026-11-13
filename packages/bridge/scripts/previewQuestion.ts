// THE PAIRING QUESTION, SHOWN WITHOUT A PAIRING: what a link asks, built by the same `question` and shown
// by the same `ask` the handler uses, for a case named on the command line — no site, no code, nothing
// kept. Under `bun --watch` a save shows it again, so the wording and the dialog are iterated on alone.
//
//   bun run bridge:preview [all|<case>] [--name <app>] [--note <text>] [--icon <png>]
//
// `all` shows every case in turn, each once the last is answered. `--note ""` shows them with none.
// Not shipped: `files` takes `bin` and `src` alone.

import { ask } from '../src/desktop.ts'
import {
    type HandlerSettings,
    offersSiteTools,
    question,
} from '../src/opened.ts'
import type { Pairing } from '../src/pairingLink.ts'

const SETTINGS: HandlerSettings = {
    bun: '',
    claude: '',
    path: '',
    claudeArgs: [],
    full: false,
    env: {},
}

// Each case: what the link asks for, what install kept, and the MCP tools whose server is missing.
const CASES: Record<
    string,
    {
        tools?: string[]
        full?: boolean
        settings?: Partial<HandlerSettings>
        unserved?: string[]
    }
> = {
    full: { full: true },
    tools: { tools: ['Read', 'Edit', 'Bash'] },
    web: { tools: ['WebSearch', 'WebFetch'] },
    many: {
        tools: [
            'Read',
            'Grep',
            'Edit',
            'Bash',
            'WebSearch',
            'mcp__github__create_issue',
            'mcp__github__list_pulls',
            'mcp__github__merge_pull',
            'mcp__linear__create_issue',
            'mcp__mail',
            'mcp__calendar__meetings',
        ],
    },
    missing: {
        tools: ['WebSearch', 'mcp__calendar__meetings'],
        unserved: ['mcp__calendar__meetings'],
    },
    none: {},
    installed: { full: true, settings: { full: true } },
    kept: {
        tools: ['Read'],
        settings: {
            claudeArgs: ['--model', 'opus'],
            env: { GITHUB_TOKEN: 'hidden' },
        },
    },
}

const [chosen = 'full', ...rest] = process.argv.slice(2)
const flags = new Map<string, string>()
for (let at = 0; at < rest.length; at += 2)
    flags.set(rest[at] as string, rest[at + 1] ?? '')
const names = chosen === 'all' ? Object.keys(CASES) : [chosen]
const icon = await Bun.file(
    flags.get('--icon') ??
        `${import.meta.dir}/../../dogfood/src/public/icon.png`,
)
    .bytes()
    .catch(() => undefined)

for (const name of names) {
    const shown = CASES[name]
    if (shown === undefined) {
        console.error(
            `No case named ${name}: one of all, ${Object.keys(CASES).join(', ')}.`,
        )
        process.exit(2)
    }
    const settings = { ...SETTINGS, ...shown.settings }
    const pairing: Pairing = {
        site: 'http://localhost:3000',
        code: 'preview',
        version: '0.0.0',
        tools: shown.tools ?? [],
        full: shown.full ?? false,
    }
    const asked = question(pairing, settings, shown.unserved ?? [], {
        name: flags.get('--name') ?? 'abide-docs',
        note:
            (flags.get('--note') ??
                'So the assistant can build what you ask for, not just answer from the docs.') ||
            undefined,
    })
    console.log(`── ${name}\n${asked.headline}\n\n${asked.body}\n`)
    const answer = await ask(
        { ...asked, icon },
        offersSiteTools(pairing, settings),
    )
    console.log(`→ ${answer}\n`)
}
