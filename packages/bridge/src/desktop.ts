// WHAT THE LINK HANDLER SHOWS THE VISITOR, on each desktop it installs on: the question before a pairing
// (44.42) and a notification for each line the bridge says. The question is each desktop's own —
// macOS's `NSAlert` (`macAlert.ts`), a Windows Forms dialog, zenity or kdialog on Linux — by the asking
// app's name and icon (44.90), with Don't Allow pressed by Return. Everything shown is passed as an
// argument, a variable or a file, never written into a script, so nothing a site names is read as code.
//
// 44.64 — A QUESTION THAT CANNOT BE SHOWN IS A NO: a Linux desktop with neither `zenity` nor `kdialog`
// pairs nothing from a link.

import { rm } from 'node:fs/promises' // bun has no remove of its own
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { macAlert } from './macAlert.ts'

/**
 * What the visitor answered: don't pair, pair as the link asks, or — offered only where it asks for full
 * access (44.86) — pair with the site's own tools alone.
 */
export type Answer = 'deny' | 'allow' | 'siteTools'

/**
 * What the visitor is asked: by the app `title` names, with its `icon` where the site has one, a
 * headline shown bold where the desktop can, and the body under it.
 */
export type Question = {
    title: string
    headline: string
    body: string
    icon: Uint8Array | undefined
}

const TITLE = 'abide bridge'
const DENY = 'Don’t Allow'
const ALLOW = 'Allow'
const ALLOW_FULL = 'Allow Full Access'
const SITE_TOOLS = 'Only Site Tools'

// A Windows Forms dialog: the icon at the left, the headline in bold over the body, and the buttons in
// `ABIDE_BRIDGE_BUTTONS` laid right to left, the first pressed by Enter and by Escape. It prints the
// index of the button pressed; closing it is the first.
const WINDOWS_DIALOG = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = $env:ABIDE_BRIDGE_TITLE
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.AutoSize = $true
$form.AutoSizeMode = 'GrowAndShrink'
$form.Padding = New-Object System.Windows.Forms.Padding(20)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$grid = New-Object System.Windows.Forms.TableLayoutPanel
$grid.AutoSize = $true
$grid.ColumnCount = 2
$grid.RowCount = 3
$form.Controls.Add($grid)
if ($env:ABIDE_BRIDGE_ICON) {
    $image = [System.Drawing.Image]::FromFile($env:ABIDE_BRIDGE_ICON)
    $picture = New-Object System.Windows.Forms.PictureBox
    $picture.Image = $image
    $picture.SizeMode = 'Zoom'
    $picture.Width = 64
    $picture.Height = 64
    $picture.Margin = New-Object System.Windows.Forms.Padding(0, 0, 16, 0)
    $grid.Controls.Add($picture, 0, 0)
    $grid.SetRowSpan($picture, 2)
    $form.Icon = [System.Drawing.Icon]::FromHandle((New-Object System.Drawing.Bitmap($image, 32, 32)).GetHicon())
}
$headline = New-Object System.Windows.Forms.Label
$headline.Text = $env:ABIDE_BRIDGE_HEADLINE
$headline.AutoSize = $true
$headline.MaximumSize = New-Object System.Drawing.Size(420, 0)
$headline.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$grid.Controls.Add($headline, 1, 0)
$body = New-Object System.Windows.Forms.Label
$body.Text = $env:ABIDE_BRIDGE_BODY
$body.AutoSize = $true
$body.MaximumSize = New-Object System.Drawing.Size(420, 0)
$body.Margin = New-Object System.Windows.Forms.Padding(3, 10, 3, 0)
$grid.Controls.Add($body, 1, 1)
$row = New-Object System.Windows.Forms.FlowLayoutPanel
$row.FlowDirection = 'RightToLeft'
$row.AutoSize = $true
$row.Dock = 'Fill'
$row.Margin = New-Object System.Windows.Forms.Padding(0, 18, 0, 0)
$grid.Controls.Add($row, 1, 2)
$script:pressed = 0
$labels = $env:ABIDE_BRIDGE_BUTTONS -split [char]10
for ($at = 0; $at -lt $labels.Length; $at++) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $labels[$at]
    $button.AutoSize = $true
    $button.Tag = $at
    $button.Add_Click({ param($clicked) $script:pressed = $clicked.Tag; $form.Close() })
    $row.Controls.Add($button)
}
$form.AcceptButton = $row.Controls[0]
$form.CancelButton = $row.Controls[0]
$form.Add_Shown({ $form.Activate() })
[void]$form.ShowDialog()
$script:pressed
`

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

/** Writes `icon` where a dialog can read it as a file, answering where, or `undefined` for none. */
async function iconFile(
    icon: Uint8Array | undefined,
): Promise<string | undefined> {
    if (icon === undefined) return undefined
    const file = `${tmpdir()}/abide-bridge-icon-${crypto.randomUUID()}.png`
    await Bun.write(file, icon)
    return file
}

/** The buttons a question is answered with, right to left: Don't Allow first, so Return presses it. */
export function buttonsOf(offerSiteTools: boolean): string[] {
    return offerSiteTools ? [DENY, ALLOW_FULL, SITE_TOOLS] : [DENY, ALLOW]
}

/** The answer the button at `index` of `buttonsOf(offerSiteTools)` gives; any other is a no. */
export function answerAt(index: number, offerSiteTools: boolean): Answer {
    if (index === 1) return 'allow'
    return index === 2 && offerSiteTools ? 'siteTools' : 'deny'
}

/**
 * The command that shows `question` on a Linux desktop, by the first of `zenity` and `kdialog` it
 * `has`, or `undefined` where it has neither — with the app's icon from the file `icon` where there is
 * one, and offering the site's own tools alone as a third button where `offerSiteTools`.
 */
export function linuxQuestion(
    question: Question,
    offerSiteTools: boolean,
    has: (tool: string) => boolean,
    icon?: string,
): string[] | undefined {
    const allow = offerSiteTools ? ALLOW_FULL : ALLOW
    if (has('zenity'))
        return [
            'zenity',
            '--question',
            '--title',
            question.title,
            ...(icon === undefined ? [] : ['--window-icon', icon]),
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
            question.title,
            ...(icon === undefined ? [] : ['--icon', icon]),
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
    const buttons = buttonsOf(offerSiteTools)
    if (platform === 'darwin')
        return answerAt(
            macAlert(question.headline, question.body, question.icon, buttons),
            offerSiteTools,
        )
    if (platform !== 'win32' && platform !== 'linux') return 'deny'
    const icon = await iconFile(question.icon)
    try {
        if (platform === 'win32') {
            const shown = await ran(
                [
                    'powershell.exe',
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    WINDOWS_DIALOG,
                ],
                {
                    ABIDE_BRIDGE_TITLE: question.title,
                    ABIDE_BRIDGE_HEADLINE: question.headline,
                    ABIDE_BRIDGE_BODY: question.body,
                    ABIDE_BRIDGE_ICON: icon ?? '',
                    ABIDE_BRIDGE_BUTTONS: buttons.join('\n'),
                },
            )
            return shown?.code === 0
                ? answerAt(Number(shown.printed), offerSiteTools)
                : 'deny'
        }
        const command = linuxQuestion(
            question,
            offerSiteTools,
            (tool) => Bun.which(tool) !== null,
            icon,
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
    } finally {
        if (icon !== undefined) await rm(icon, { force: true })
    }
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
