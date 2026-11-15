// A WKWebView as the window and the menu bar extra's panel each show a page in.

import { FFIType } from 'bun:ffi'

import {
    created,
    type Id,
    nsBoolean,
    nsString,
    selector,
    send,
    sendFlag,
    sendTyped,
} from './appKit.ts'
import { nativeUserAgent } from './nativeUserAgent.ts'

/**
 * A web view open to Web Inspector where `inspector` says (38.163), answering its prompts and
 * navigations through `uiDelegate`, and carrying the native app's user agent at `version` (38.140).
 */
export function webViewFor(
    inspector: boolean,
    version: string,
    uiDelegate: Id,
): Id {
    const view = created('WKWebView')
    if (inspector) {
        send(
            send(send(view, 'configuration'), 'preferences'),
            'setValue:forKey:',
            nsBoolean(true),
            nsString('developerExtrasEnabled'),
        )
        // macOS 13.3 and later hold a view closed to Safari's inspector until it is made inspectable.
        if (
            sendTyped(
                view,
                'respondsToSelector:',
                [FFIType.ptr],
                FFIType.bool,
                selector('setInspectable:'),
            )
        )
            sendFlag(view, 'setInspectable:', true)
    }
    send(view, 'setUIDelegate:', uiDelegate)
    send(view, 'setNavigationDelegate:', uiDelegate)
    send(view, 'setCustomUserAgent:', nsString(nativeUserAgent(version)))
    return view
}
