// THE PAIRING QUESTION, SHOWN WITHOUT A PAIRING: what a link asks, built by the same `question` and shown
// by the same `ask` the handler uses, for a level named on the command line — no site, no code, nothing
// kept. Under `bun --watch` a save shows it again, so the wording and the dialog are iterated on alone.
//
//   bun run bridge:preview [full|tools|none|installed] [--name <app>] [--note <text>] [--icon <png>]
//
// Not shipped: `files` takes `bin` and `src` alone.

import { ask } from '../src/desktop.ts'
import { type HandlerSettings, question } from '../src/opened.ts'

const [level = 'full', ...rest] = process.argv.slice(2)
const flags = new Map<string, string>()
for (let at = 0; at < rest.length; at += 2)
    flags.set(rest[at] as string, rest[at + 1] ?? '')

const settings: HandlerSettings = {
    bun: '',
    claude: '',
    path: '',
    claudeArgs: [],
    full: level === 'installed',
    env: {},
}
const icon =
    flags.get('--icon') ??
    `${import.meta.dir}/../../dogfood/src/public/icon.png`
const asked = question(
    {
        site: 'http://localhost:3000',
        code: 'preview',
        version: '0.0.0',
        tools: level === 'tools' ? ['Read', 'Edit', 'Bash'] : [],
        full: level === 'full',
    },
    settings,
    [],
    {
        name: flags.get('--name') ?? 'abide-docs',
        note:
            flags.get('--note') ??
            'So the assistant can build what you ask for, not just answer from the docs.',
    },
)
console.log(`${asked.headline}\n\n${asked.body}\n`)
const answer = await ask(
    {
        ...asked,
        icon: await Bun.file(icon)
            .bytes()
            .catch(() => undefined),
    },
    level === 'full',
)
console.log(`→ ${answer}`)
