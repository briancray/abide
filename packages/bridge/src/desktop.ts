// WHAT THE LINK HANDLER SHOWS THE VISITOR, on each desktop it installs on: the question before a pairing
// (44.42) and a notification for each line the bridge says. Every question is passed as an argument or
// a variable, never written into a script, so nothing a site names is read as code.
//
// 44.64 — A QUESTION THAT CANNOT BE SHOWN IS A NO: a Linux desktop with neither `zenity` nor `kdialog`
// pairs nothing from a link.

/** What the visitor answered: don't pair, pair this once, or pair and stop asking for this site. */
export type Answer = 'deny' | 'once' | 'always'

const TITLE = 'abide bridge'
const DENY = 'Don’t Allow'
const ONCE = 'Allow'
const ALWAYS = 'Always Allow'

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

/** Runs one AppleScript with `argument` as `item 1 of argv`. */
function appleScript(
    lines: string[],
    argument: string,
): ReturnType<typeof ran> {
    const script: string[] = ['-e', 'on run argv']
    for (const line of lines) script.push('-e', line)
    script.push('-e', 'end run')
    return ran(['osascript', ...script, argument])
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
 * `has`, or `undefined` where it has neither.
 */
export function linuxQuestion(
    question: string,
    offerAlways: boolean,
    has: (tool: string) => boolean,
): string[] | undefined {
    if (has('zenity'))
        return [
            'zenity',
            '--question',
            '--title',
            TITLE,
            '--text',
            question,
            '--no-markup',
            '--ok-label',
            ONCE,
            '--cancel-label',
            DENY,
            ...(offerAlways ? ['--extra-button', ALWAYS] : []),
        ]
    if (has('kdialog'))
        return [
            'kdialog',
            '--title',
            TITLE,
            offerAlways ? '--yesnocancel' : '--yesno',
            question,
            '--yes-label',
            ONCE,
            ...(offerAlways
                ? ['--no-label', ALWAYS, '--cancel-label', DENY]
                : ['--no-label', DENY]),
        ]
    return undefined
}

/** Asks the visitor `question`, offering to always allow where `offerAlways`; closing it is a no. */
export async function ask(
    question: string,
    offerAlways: boolean,
): Promise<Answer> {
    const platform = process.platform
    if (platform === 'darwin') {
        const buttons = offerAlways
            ? `{"${DENY}", "${ALWAYS}", "${ONCE}"}`
            : `{"${DENY}", "${ONCE}"}`
        const pressed = await appleScript(
            [
                `display dialog (item 1 of argv) with title "${TITLE}" buttons ${buttons} default button "${DENY}" cancel button "${DENY}" with icon caution`,
                'button returned of result',
            ],
            question,
        )
        if (pressed?.code !== 0) return 'deny'
        return pressed.printed === ALWAYS
            ? 'always'
            : pressed.printed === ONCE
              ? 'once'
              : 'deny'
    }
    if (platform === 'win32') {
        // A message box's buttons carry no labels of their own, so always is a second question.
        const box = (buttons: string, text: string): Promise<string> =>
            powerShell(
                `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($env:ABIDE_BRIDGE_TEXT, '${TITLE}', '${buttons}', 'Warning', 'Button2')`,
                text,
            )
        if ((await box('YesNo', `${question}\n\nAllow it?`)) !== 'Yes')
            return 'deny'
        if (!offerAlways) return 'once'
        return (await box(
            'YesNo',
            'Always allow this site, as the same account, without asking?',
        )) === 'Yes'
            ? 'always'
            : 'once'
    }
    if (platform !== 'linux') return 'deny'
    const command = linuxQuestion(
        question,
        offerAlways,
        (tool) => Bun.which(tool) !== null,
    )
    if (command === undefined) return 'deny'
    const shown = await ran(command)
    if (shown === undefined) return 'deny'
    if (command[0] === 'zenity')
        return shown.code === 0
            ? 'once'
            : shown.printed === ALWAYS
              ? 'always'
              : 'deny'
    // kdialog: yes is once, and no is always where always was offered.
    if (shown.code === 0) return 'once'
    return offerAlways && shown.code === 1 ? 'always' : 'deny'
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
