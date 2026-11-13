// THE DESKTOP APP'S MENU BAR AS DATA (38.88): the default, with the menus the standing layouts and
// page file with `onMenu` — apart from `installMenu.ts`, which builds it as an `NSMenu`, so what the
// bar holds is read without AppKit.

import type { NativeMenuItem } from '#shared/menuItem.ts'

/**
 * The menu bar the window shows: the application, File, Edit, View and Window menus, and `added`.
 *
 * 38.88 — AN ADDED MENU NAMED AS A DEFAULT ONE GROWS IT, and any other stands before Window, where
 * the platform puts an app's own. 38.83 — no Connect… where what `onLauncher` answers turns connecting off.
 * 38.149 — the `update` role under the app's name where `onLauncher` answers an `update`, labelled
 * `update`.
 */
export function menuBar(
    appName: string,
    connect: boolean,
    added: NativeMenuItem[],
    update: string | undefined,
): NativeMenuItem[] {
    const bar = defaultMenu(appName, connect, update)
    const window = bar.pop() as NativeMenuItem
    for (const menu of added) {
        const named =
            menu === 'separator'
                ? undefined
                : bar.find(
                      (standing) =>
                          standing !== 'separator' &&
                          standing.label === menu.label,
                  )
        if (
            named === undefined ||
            named === 'separator' ||
            menu === 'separator'
        )
            bar.push(menu)
        else named.items = [...(named.items ?? []), ...(menu.items ?? [])]
    }
    bar.push(window)
    return bar
}

function defaultMenu(
    appName: string,
    connect: boolean,
    update: string | undefined,
): NativeMenuItem[] {
    return [
        {
            label: appName,
            items: [
                { label: `About ${appName}`, role: 'about' },
                ...(update === undefined
                    ? []
                    : ([
                          { label: update, role: 'update' },
                      ] as NativeMenuItem[])),
                'separator',
                { label: `Hide ${appName}`, role: 'hide', key: 'cmd+h' },
                { label: 'Hide Others', role: 'hideOthers', key: 'cmd+alt+h' },
                { label: 'Show All', role: 'showAll' },
                'separator',
                { label: `Quit ${appName}`, role: 'quit', key: 'cmd+q' },
            ],
        },
        {
            label: 'File',
            items: [
                ...(connect
                    ? ([
                          { label: 'Connect…', role: 'connect', key: 'cmd+k' },
                      ] as NativeMenuItem[])
                    : []),
                { label: 'Disconnect', role: 'disconnect', key: 'cmd+shift+k' },
                'separator',
                { label: 'Close Window', role: 'close', key: 'cmd+w' },
            ],
        },
        {
            label: 'Edit',
            items: [
                { label: 'Undo', role: 'undo', key: 'cmd+z' },
                { label: 'Redo', role: 'redo', key: 'cmd+shift+z' },
                'separator',
                { label: 'Cut', role: 'cut', key: 'cmd+x' },
                { label: 'Copy', role: 'copy', key: 'cmd+c' },
                { label: 'Paste', role: 'paste', key: 'cmd+v' },
                { label: 'Select All', role: 'selectAll', key: 'cmd+a' },
            ],
        },
        {
            label: 'View',
            items: [
                { label: 'Reload', role: 'reload', key: 'cmd+r' },
                'separator',
                {
                    label: 'Enter Full Screen',
                    role: 'fullscreen',
                    key: 'ctrl+cmd+f',
                },
            ],
        },
        {
            label: 'Window',
            items: [
                { label: 'Minimize', role: 'minimize', key: 'cmd+m' },
                { label: 'Zoom', role: 'zoom' },
                'separator',
                { label: 'Bring All to Front', role: 'front' },
            ],
        },
    ]
}
