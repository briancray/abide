// 38.72 — THE DESKTOP LAUNCHER'S OWN PAGE: start the app here, under the configuration the form
// holds, or connect to one running elsewhere. The app's own screen and not abide's, so it speaks
// the platform's look rather than the docs site's.

import { escapeAttribute, escapeText } from '#shared/escapeText.ts'
import type { ConfigField } from './configFields.ts'

/**
 * What a launch page is rendered with: `src/bundle/launch.abide`'s props, and the built-in page's.
 *
 * 38.84 — a form the launcher does not offer has no address to post to.
 */
export type Launch = {
    /** The app's name, as `launcher.json` gives it or as its package does. */
    name: string
    /** Where the start form posts, or `undefined` where `launcher.json` turns starting off. */
    start: string | undefined
    /** Where the connect form posts, or `undefined` where `launcher.json` turns connecting off. */
    connect: string | undefined
    fields: ConfigField[]
    /** The URL the last connect was given. */
    url: string
    /** What went wrong with the last start or connect, and against which form. */
    failure:
        | {
              form: 'start' | 'connect'
              message: string
              issues: Record<string, string[]>
          }
        | undefined
    /** The form the page opens on. */
    focus: 'start' | 'connect'
}

/** The built-in launcher page as markup. */
export function launcherPage(page: Launch): string {
    const startFailure =
        page.failure?.form === 'start' ? page.failure : undefined
    const connectFailure =
        page.failure?.form === 'connect' ? page.failure : undefined
    let inputs = ''
    for (const field of page.fields) {
        const issues = startFailure?.issues[field.name] ?? []
        const id = `field-${escapeAttribute(field.name)}`
        const name = escapeAttribute(field.name)
        let control: string
        if (field.input === 'checkbox')
            control = `<input type="hidden" name="${name}" value="false"><input id="${id}" type="checkbox" name="${name}" value="true"${field.value === 'true' ? ' checked' : ''}>`
        else if (field.input === 'select') {
            let options = ''
            for (const option of field.options ?? [])
                options += `<option${option === field.value ? ' selected' : ''}>${escapeText(option)}</option>`
            control = `<select id="${id}" name="${name}"${field.required ? ' required' : ''}>${options}</select>`
        } else
            control = `<input id="${id}" type="${field.input}" name="${name}" value="${escapeAttribute(field.value)}"${field.required ? ' required' : ''}${field.input === 'number' ? ' step="any"' : ''} autocomplete="off" spellcheck="false">`
        inputs += `
            <div class="field${field.input === 'checkbox' ? ' check' : ''}${issues.length > 0 ? ' invalid' : ''}">
                <label for="${id}">${escapeText(field.label)}</label>
                ${control}
                ${field.description === undefined ? '' : `<p class="hint">${escapeText(field.description)}</p>`}
                ${issues.map((issue) => `<p class="issue">${escapeText(issue)}</p>`).join('')}
            </div>`
    }
    // 27.7's issues under `''` are the whole document's — a refinement across fields — and no
    // field shows them.
    const failureLine = (
        failure:
            | { message: string; issues: Record<string, string[]> }
            | undefined,
    ): string => {
        if (failure === undefined) return ''
        let line = `<p class="failure" role="alert">${escapeText(failure.message)}</p>`
        for (const issue of failure.issues[''] ?? [])
            line += `<p class="issue">${escapeText(issue)}</p>`
        return line
    }
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(page.name)}</title>
<style>
:root { color-scheme: light dark; --ground: #f5f5f7; --card: #fff; --ink: #1d1d1f; --muted: #6e6e73; --line: #d2d2d7; --accent: #0a84ff; --bad: #d70015; }
@media (prefers-color-scheme: dark) { :root { --ground: #1c1c1e; --card: #2c2c2e; --ink: #f5f5f7; --muted: #98989d; --line: #3a3a3c; --bad: #ff6961; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font: 13px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; background: var(--ground); color: var(--ink); display: flex; align-items: flex-start; justify-content: center; padding: 48px 24px; overflow-y: auto; -webkit-user-select: none; user-select: none; }
main { width: 100%; max-width: 440px; }
h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; }
.lede { color: var(--muted); margin: 0 0 24px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
section.focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
section > p.about { color: var(--muted); margin: 0 0 16px; }
.field { display: grid; gap: 4px; margin-bottom: 12px; }
.field.check { grid-template-columns: auto 1fr; align-items: center; column-gap: 8px; }
.field.check label { order: 2; }
.field.check input[type=checkbox] { order: 1; margin: 0; }
.field.check .hint, .field.check .issue { grid-column: 1 / -1; order: 3; }
label { font-weight: 500; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
input[type=text], input[type=number], input[type=password], input[type=url], select { font: inherit; color: inherit; background: var(--ground); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; width: 100%; -webkit-user-select: text; user-select: text; }
input:focus, select:focus { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 0; border-color: var(--accent); }
.invalid input, .invalid select { border-color: var(--bad); }
.hint { color: var(--muted); margin: 0; font-size: 12px; }
.issue, .failure { color: var(--bad); margin: 0; font-size: 12px; }
.failure { margin-bottom: 12px; -webkit-user-select: text; user-select: text; }
.actions { display: flex; justify-content: flex-end; margin-top: 16px; }
button { font: inherit; font-weight: 500; color: #fff; background: var(--accent); border: 0; border-radius: 6px; padding: 6px 16px; cursor: default; }
button:active { filter: brightness(0.9); }
button[disabled] { opacity: 0.6; }
.empty { color: var(--muted); margin: 0; }
</style>
</head>
<body>
<main>
    <h1>${escapeText(page.name)}</h1>
    <p class="lede">${page.start === undefined ? 'Connect to the app where it is running.' : page.connect === undefined ? 'Start the app on this computer.' : 'Start the app on this computer, or connect to one already running.'}</p>
${
    page.start === undefined
        ? ''
        : `    <section id="start"${page.focus === 'start' ? ' class="focus"' : ''}>
        <h2>Start</h2>
        <p class="about">Runs the app here, with this configuration.</p>
        <form method="post" action="${escapeAttribute(page.start)}">
            ${failureLine(startFailure)}
            ${inputs === '' ? '<p class="empty">This app takes no configuration.</p>' : inputs}
            <div class="actions"><button type="submit">Start</button></div>
        </form>
    </section>`
}
    ${
        page.connect === undefined
            ? ''
            : `    <section id="connect"${page.focus === 'connect' ? ' class="focus"' : ''}>
        <h2>Connect</h2>
        <p class="about">Opens the app running at another address.</p>
        <form method="post" action="${escapeAttribute(page.connect)}">
            ${failureLine(connectFailure)}
            <div class="field${connectFailure === undefined ? '' : ' invalid'}">
                <label for="connect-url">URL</label>
                <input id="connect-url" type="url" name="url" value="${escapeAttribute(page.url)}" placeholder="https://" required autocomplete="off" spellcheck="false">
            </div>
            <div class="actions"><button type="submit">Connect</button></div>
        </form>
    </section>`
    }
</main>
<script>
for (const form of document.forms) form.addEventListener('submit', () => { for (const button of form.querySelectorAll('button')) { button.disabled = true; button.textContent = button.textContent === 'Start' ? 'Starting…' : 'Connecting…' } })
document.querySelector('${page.focus === 'connect' ? '#connect-url' : '#start input:not([type=hidden]), #start select'}')?.focus()
</script>
</body>
</html>
`
}
