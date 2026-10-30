// 38.71 — THE DESKTOP LAUNCHER'S OWN PAGE: start the app here, under the configuration the form
// holds, or connect to one running elsewhere. The app's own screen and not abide's, so it speaks
// the platform's look rather than the docs site's — and the app's color, read off its icon (38.101).
//
// TWO BUTTONS AND A DIALOG EACH (38.102): the page is the app's icon, its name and what can be done,
// and a form opens only once it is asked for. `…` on a button is the platform's own sign that it
// asks something first, so a Start with no configuration to ask for has none and starts at once.

import { escapeAttribute, escapeText } from '#shared/escapeText.ts'

import type { ConfigField } from './configFields.ts'
import { inkOn } from './iconAccent.ts'

// 38.101 — the accent where the app has no icon to take one from.
const SYSTEM_ACCENT = '#0a84ff'

/**
 * What a launch page is rendered with: `src/launcher.abide`'s props, and the built-in page's.
 *
 * 38.83 — a form the launcher does not offer has no address to post to.
 */
export type Launch = {
    /** The app's name, as its package gives it. */
    name: string
    /** Where the start form posts, or `undefined` where what `onLauncher` answers turns starting off. */
    start: string | undefined
    /** Where the connect form posts, or `undefined` where what `onLauncher` answers turns connecting off. */
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
    /** 38.102 — the form the page opens on: the one refused, or the one the menu asked for. */
    focus: 'start' | 'connect' | undefined
    /** 38.101 — the app's icon, as a data URL, where it has one. */
    icon: string | undefined
    /** 38.101 — the color taken from the icon, as `#rrggbb`, where it gives one. */
    accent: string | undefined
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
            { message: string; issues: Record<string, string[]> } | undefined,
    ): string => {
        if (failure === undefined) return ''
        let line = `<p class="failure" role="alert">${escapeText(failure.message)}</p>`
        for (const issue of failure.issues[''] ?? [])
            line += `<p class="issue">${escapeText(issue)}</p>`
        return line
    }
    const accent = page.accent ?? SYSTEM_ACCENT
    const name = escapeText(page.name)
    // A START WITH NOTHING TO ASK posts from the page itself; one with fields opens its dialog.
    const asks = inputs !== '' || startFailure !== undefined
    // A refused form opens on its refusal; a start that asks for nothing has no dialog to open.
    const focus = page.failure?.form ?? page.focus
    const opened =
        focus === undefined || (focus === 'start' && !asks)
            ? ''
            : `${focus}-dialog`
    let buttons = ''
    let dialogs = ''
    if (page.start !== undefined) {
        buttons += asks
            ? '<button class="primary" type="button" data-opens="start-dialog">Start…</button>'
            : `<form method="post" action="${escapeAttribute(page.start)}"><button class="primary" type="submit">Start</button></form>`
        if (asks)
            dialogs += `
<dialog id="start-dialog" aria-labelledby="start-title">
    <form method="post" action="${escapeAttribute(page.start)}">
        <h2 id="start-title">Start ${name}</h2>
        <p class="about">Runs ${name} on this computer.</p>
        ${failureLine(startFailure)}
        ${inputs}
        <div class="actions">
            <button type="button" data-closes>Cancel</button>
            <button class="primary" type="submit">Start</button>
        </div>
    </form>
</dialog>`
    }
    if (page.connect !== undefined) {
        buttons += `<button${page.start === undefined ? ' class="primary"' : ''} type="button" data-opens="connect-dialog">Connect…</button>`
        dialogs += `
<dialog id="connect-dialog" aria-labelledby="connect-title">
    <form method="post" action="${escapeAttribute(page.connect)}">
        <h2 id="connect-title">Connect to ${name}</h2>
        <p class="about">Opens ${name} where it is already running.</p>
        ${failureLine(connectFailure)}
        <div class="field${connectFailure === undefined ? '' : ' invalid'}">
            <label for="connect-url">URL</label>
            <input id="connect-url" type="url" name="url" value="${escapeAttribute(page.url)}" placeholder="https://" required autocomplete="off" spellcheck="false">
        </div>
        <div class="actions">
            <button type="button" data-closes>Cancel</button>
            <button class="primary" type="submit">Connect</button>
        </div>
    </form>
</dialog>`
    }
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
:root { color-scheme: light dark; --accent: ${accent}; --accent-ink: ${inkOn(accent)}; --ground: color-mix(in srgb, var(--accent) 7%, #f7f7f8); --card: #fff; --ink: #1d1d1f; --muted: #6e6e73; --line: color-mix(in srgb, var(--ink) 14%, transparent); --field: #fff; --bad: #d70015; --ring: color-mix(in srgb, var(--accent) 40%, transparent); }
@media (prefers-color-scheme: dark) { :root { --ground: color-mix(in srgb, var(--accent) 10%, #161618); --card: #232325; --ink: #f5f5f7; --muted: #98989d; --field: #1b1b1d; --bad: #ff6961; --ring: color-mix(in srgb, var(--accent) 55%, transparent); } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font: 13px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; background: var(--ground); color: var(--ink); display: grid; place-items: center; padding: 32px; -webkit-user-select: none; user-select: none; }
main { display: grid; justify-items: center; text-align: center; margin-top: -4vh; }
.icon { width: 128px; height: 128px; margin-bottom: 12px; }
.mark { display: grid; place-items: center; width: 104px; height: 104px; margin: 12px 0 24px; border-radius: 24px; background: linear-gradient(color-mix(in srgb, var(--accent) 82%, white), var(--accent)); color: var(--accent-ink); font-size: 52px; font-weight: 600; box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 30%, transparent); }
h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 28px; }
.buttons { display: flex; gap: 10px; }
.buttons form { display: contents; }
button { font: inherit; font-weight: 500; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 16px; min-width: 96px; cursor: default; }
main button { font-size: 14px; padding: 8px 20px; min-width: 128px; }
button.primary { color: var(--accent-ink); background: var(--accent); border-color: transparent; }
button:focus-visible { outline: 3px solid var(--ring); outline-offset: 1px; }
button:active { filter: brightness(0.92); }
button[disabled] { opacity: 0.6; }
dialog { width: min(400px, calc(100vw - 48px)); max-height: calc(100vh - 48px); padding: 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); color: var(--ink); box-shadow: 0 24px 64px rgb(0 0 0 / 0.28); text-align: left; }
dialog::backdrop { background: rgb(0 0 0 / 0.22); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
h2 { font-size: 15px; font-weight: 600; margin: 0 0 2px; }
.about { color: var(--muted); margin: 0 0 18px; }
.field { display: grid; gap: 4px; margin-bottom: 12px; }
.field.check { grid-template-columns: auto 1fr; align-items: center; column-gap: 8px; }
.field.check label { order: 2; }
.field.check input[type=checkbox] { order: 1; margin: 0; accent-color: var(--accent); }
.field.check .hint, .field.check .issue { grid-column: 1 / -1; order: 3; }
label { font-weight: 500; font-size: 12px; }
input[type=text], input[type=number], input[type=password], input[type=url], select { font: inherit; color: inherit; background: var(--field); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; width: 100%; -webkit-user-select: text; user-select: text; }
input:focus, select:focus { outline: 3px solid var(--ring); outline-offset: 0; border-color: var(--accent); }
.invalid input, .invalid select { border-color: var(--bad); }
.hint { color: var(--muted); margin: 0; font-size: 12px; }
.issue, .failure { color: var(--bad); margin: 0; font-size: 12px; }
.failure { margin-bottom: 14px; -webkit-user-select: text; user-select: text; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
</head>
<body>
<main>
    ${page.icon === undefined ? `<div class="mark" aria-hidden="true">${escapeText(page.name.charAt(0).toUpperCase())}</div>` : `<img class="icon" src="${escapeAttribute(page.icon)}" alt="">`}
    <h1>${name}</h1>
    <div class="buttons">${buttons}</div>
</main>${dialogs}
<script>
for (const opener of document.querySelectorAll('[data-opens]')) opener.addEventListener('click', () => open(opener.dataset.opens))
for (const closer of document.querySelectorAll('[data-closes]')) closer.addEventListener('click', () => closer.closest('dialog').close())
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close() })
for (const form of document.forms) form.addEventListener('submit', () => { for (const button of form.querySelectorAll('button')) { button.disabled = true; if (button.type === 'submit') button.textContent = button.textContent === 'Start' ? 'Starting…' : 'Connecting…' } })
function open(id) { const dialog = document.getElementById(id); dialog.showModal(); (dialog.querySelector('.invalid input:not([type=hidden]), .invalid select') ?? dialog.querySelector('input:not([type=hidden]), select'))?.focus() }
${opened === '' ? '' : `open('${opened}')`}
</script>
</body>
</html>
`
}
