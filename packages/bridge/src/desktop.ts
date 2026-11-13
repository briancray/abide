// WHAT THE LINK HANDLER SHOWS THE VISITOR, on each desktop it installs on: the question before a pairing
// (44.42) and a notification for each line the bridge says. Every question is passed as an argument or
// a variable, never written into a script, so nothing a site names is read as code.
//
// 44.64 — A QUESTION THAT CANNOT BE SHOWN IS A NO: a Linux desktop with neither `zenity` nor `kdialog`
// pairs nothing from a link.

/**
 * What the visitor answered: don't pair, pair as the link asks, or — offered only where it asks for full
 * access (44.85) — pair with the site's own tools alone.
 */
export type Answer = 'deny' | 'allow' | 'siteTools'

/** What the visitor is asked: a headline, shown bold where the desktop can, and the body under it. */
export type Question = { headline: string; body: string }

const TITLE = 'abide bridge'
const DENY = 'Don’t Allow'
const ALLOW = 'Allow'
const ALLOW_FULL = 'Allow Full Access'
const SITE_TOOLS = 'Only Site Tools'

/** Runs `command`, answering its exit code and what it printed, or `undefined` where it could not start. */
async function ran(
    command: string[],
    env?: Record<string, string>,
): Promise<{ code: number; printed: string } | undefined> {
    try {
        const child = Bun.spawn(command, {
            stdout: 'pipe',
            stderr: 'ignore',
            env: { ...Bun.env, ...env },
        })
        const printed = (await new Response(child.stdout).text()).trim()
        return { code: await child.exited, printed }
    } catch {
        return undefined
    }
}

/** Runs one AppleScript with `argv` as its `argv`. */
function appleScript(
    lines: string[],
    ...argv: string[]
): ReturnType<typeof ran> {
    const script: string[] = ['-e', 'on run argv']
    for (const line of lines) script.push('-e', line)
    script.push('-e', 'end run')
    return ran(['osascript', ...script, ...argv])
}

/** A PowerShell script, run with `text` in `ABIDE_BRIDGE_TEXT`, answering what it printed. */
async function powerShell(script: string, text: string): Promise<string> {
    const done = await ran(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
        { ABIDE_BRIDGE_TEXT: text },
    )
    return done?.code === 0 ? done.printed : ''
}

/**
 * The command that shows `question` on a Linux desktop, by the first of `zenity` and `kdialog` it
 * `has`, or `undefined` where it has neither — offering the site's own tools alone as a third button
 * where `offerSiteTools`.
 */
export function linuxQuestion(
    question: Question,
    offerSiteTools: boolean,
    has: (tool: string) => boolean,
): string[] | undefined {
    const allow = offerSiteTools ? ALLOW_FULL : ALLOW
    if (has('zenity'))
        return [
            'zenity',
            '--question',
            '--title',
            TITLE,
            '--text',
            // Pango markup, so all a site names is escaped.
            `<b>${Bun.escapeHTML(question.headline)}</b>\n\n${Bun.escapeHTML(question.body)}`,
            '--ok-label',
            allow,
            '--cancel-label',
            DENY,
            ...(offerSiteTools ? ['--extra-button', SITE_TOOLS] : []),
        ]
    if (has('kdialog'))
        return [
            'kdialog',
            '--title',
            TITLE,
            offerSiteTools ? '--yesnocancel' : '--yesno',
            `${question.headline}\n\n${question.body}`,
            '--yes-label',
            allow,
            ...(offerSiteTools
                ? ['--no-label', SITE_TOOLS, '--cancel-label', DENY]
                : ['--no-label', DENY]),
        ]
    return undefined
}

/**
 * Asks the visitor `question`, offering the site's own tools alone where `offerSiteTools`; closing it
 * is a no.
 */
export async function ask(
    question: Question,
    offerSiteTools: boolean,
): Promise<Answer> {
    const platform = process.platform
    const allow = offerSiteTools ? ALLOW_FULL : ALLOW
    if (platform === 'darwin') {
        const buttons = offerSiteTools
            ? `{"${DENY}", "${SITE_TOOLS}", "${allow}"}`
            : `{"${DENY}", "${allow}"}`
        // An alert, not a dialog: its message text is the bold headline, as the system's own prompts.
        const pressed = await appleScript(
            [
                `display alert (item 1 of argv) message (item 2 of argv) as critical buttons ${buttons} default button "${DENY}" cancel button "${DENY}"`,
                'button returned of result',
            ],
            question.headline,
            question.body,
        )
        if (pressed?.code !== 0) return 'deny'
        return pressed.printed === allow
            ? 'allow'
            : pressed.printed === SITE_TOOLS
              ? 'siteTools'
              : 'deny'
    }
    if (platform === 'win32') {
        // A message box's buttons carry no labels of their own, so the text says what each one does.
        const text = offerSiteTools
            ? `${question.headline}\n\n${question.body}\n\nYes: allow full access. No: only the site’s own tools. Cancel: don’t allow.`
            : `${question.headline}\n\n${question.body}\n\nAllow it?`
        const pressed = await powerShell(
            `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($env:ABIDE_BRIDGE_TEXT, '${TITLE}', '${offerSiteTools ? 'YesNoCancel' : 'YesNo'}', 'Warning', '${offerSiteTools ? 'Button3' : 'Button2'}')`,
            text,
        )
        if (pressed === 'Yes') return 'allow'
        return offerSiteTools && pressed === 'No' ? 'siteTools' : 'deny'
    }
    if (platform !== 'linux') return 'deny'
    const command = linuxQuestion(
        question,
        offerSiteTools,
        (tool) => Bun.which(tool) !== null,
    )
    if (command === undefined) return 'deny'
    const shown = await ran(command)
    if (shown === undefined) return 'deny'
    if (shown.code === 0) return 'allow'
    if (!offerSiteTools) return 'deny'
    // zenity prints the extra button it closed with; kdialog's no is the middle of three.
    if (command[0] === 'zenity')
        return shown.printed === SITE_TOOLS ? 'siteTools' : 'deny'
    return shown.code === 1 ? 'siteTools' : 'deny'
}

/** Shows `line` as a notification, where this desktop has a way to. */
export async function notify(line: string): Promise<void> {
    if (process.platform === 'darwin')
        await appleScript(
            [`display notification (item 1 of argv) with title "${TITLE}"`],
            line,
        )
    else if (process.platform === 'linux' && Bun.which('notify-send') !== null)
        await ran(['notify-send', TITLE, line])
}
