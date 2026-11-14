# @abide/bridge

## 0.7.2

### Patch Changes

- 625e836: an answered pairing question leaves the screen — the run loop turns once after the alert is closed, as nothing else turns it ([`28c3cf5`](https://github.com/briancray/abide/commit/28c3cf5efe4a450b23a56ddd50a04578741b3317))

## 0.7.1

### Patch Changes

- eb51ccb: the pairing question leaves no unresponsive app in front once answered, draws a site with no icon as an app, and names Claude Code's Agent tool ([`65e13db`](https://github.com/briancray/abide/commit/65e13db8a3a2a7b4258e3578747f15b5c78aa5a0))

## 0.7.0

### Minor Changes

- f929fa5: one headline at every level — "<app> (<site>) is requesting access to Claude Code." — with what it asks for first in the body — 44.42 ([`3b6b3f5`](https://github.com/briancray/abide/commit/3b6b3f54ae9e6cb47eedc877c662461606e89727))
- f929fa5: the question's buttons are laid out as each desktop lays its own — Allow the default, Don't Allow on Escape ([`498200a`](https://github.com/briancray/abide/commit/498200a9d30faa9c1fc57a3b96bfb2d4621edf64))
- f929fa5: the question names what a link asks of this machine by what it lets the site do, and every MCP tool on one line counted per server — 44.65, 44.92 ([`73be13a`](https://github.com/briancray/abide/commit/73be13ab61845b0026946cdf2cb0c409be004fd7))
- f929fa5: every level of the question says what it requests the same way, offers Only Site Tools wherever it asks for anything of this machine, and remembers which was granted — 44.62, 44.86, 44.88 ([`7803bbe`](https://github.com/briancray/abide/commit/7803bbe849dc7450d9e11e95a9707c2cf7b9c2ae))
- f929fa5: Allow first, Only Site Tools beside it, Don't Allow last; each button answers by what it says — 44.86 ([`b92e292`](https://github.com/briancray/abide/commit/b92e292e8e9d0245768caad361c41b94099a3728))
- f929fa5: Allow is the question's default — blue, pressed by Return — and Escape is Don't Allow ([`cc2d66a`](https://github.com/briancray/abide/commit/cc2d66a38499b779f90daa5a42798a2b8cdb49e3))
- 7e887bb: The bridge runs Claude Code in auto mode, and asks the page about anything auto mode would ask you: `provider.claudeCode` yields each prompt as a `permission` event, and `provider.claudeCode.permit(id, allow)` answers it. A granted tool is no longer approved just for being granted. `abide-bridge --full` (and `abide-bridge install --full`) gives a site everything your Claude Code has, and the native app's own bridge always runs that way.
- fac557b: `abide-bridge install` run from a checkout of the bridge — `bun packages/bridge/bin/abideBridge.ts install` — makes every pairing link open with that checkout's handler and run its bridge, whatever release the link names, so an edit there is what the next link runs.
- af74604: A site can ask a visitor's Claude Code for full access: `provider.claudeCode.bridgeCommand({ full: true })` and `provider.claudeCode.bridge({ full: true })` carry `--full` in the command and ask for it in the link, and `ABIDE_BRIDGE_FULL` does the same for `pairing()`. Opening such a link names no tool: it says the site is requesting full access, and offers Allow, Only Site Tools or Don't Allow. Allow is now kept for the site and the person its code was minted for, with no separate Always Allow, and an ask for full access is kept as it was answered; `abide-bridge forget` undoes it. The question is a macOS alert with a bold headline, and no longer names the bridge release, which the handler's log keeps.
- 8d12435: A native app built with `abide bundle` now pairs its window with Claude Code on the same machine. Nothing needs to be installed, no link needs clicking and no code is spent (RULEBOOK 44.77). `provider.claudeCode` runs turns there, inside the app's process, and pages see an ordinary paired `BridgeStatus`. The window's turns get every tool the site asks for, both built-in tools and MCP tools whose server is in the visitor's Claude Code user scope. `missing` lists only MCP tools whose server it doesn't find (RULEBOOK 44.78). Only the window counts as local. It proves this with a cookie minted at each launch, never by its user agent (RULEBOOK 44.79).
  
  The native app runs with the `PATH` the visitor's login shell sets, so it finds `claude` even when opened from the Finder (RULEBOOK 44.80). The window and the menu bar extra's panel now hand links of other schemes, such as `abide-bridge:` and `mailto:`, to macOS instead of failing them (RULEBOOK 38.174).
  
  `@abide/abide` now depends on `@abide/bridge`. The bridge's turn handling is now one module, `@abide/bridge/serveTurns`, shared by `abide-bridge` and the native app.
- 9d74469: The question a pairing link asks is each desktop's own, by the asking app: on macOS a native `NSAlert` the bridge shows itself, in front, with the site's `/icon.png` as its icon; on Windows a dialog with a bold headline, the icon and labelled buttons in place of Yes/No/Cancel; on Linux zenity or kdialog titled by the app, with its icon. The headline names the app beside its site — `CRM (crm.example)` — which `/__abide/bridge`'s holder answer now carries as `name`.
- 6531d98: An app can say why it asks to pair: `provider.claudeCode.bridgeCommand({ note })` and `provider.claudeCode.bridge({ note })`, or `ABIDE_BRIDGE_NOTE` for `pairing()`, keep a note with the pairing's code, and the question a pairing link asks shows it under its headline as the app's own words — `From CRM: …`, one line of at most 200 characters. The rest of the question stays the bridge's.

## 0.6.2

### Patch Changes

- 068afc4: constants abide's tests read are leaves, and grant.ts exports only what is imported ([`c16c791`](https://github.com/briancray/abide/commit/c16c791c1cee3a1a4f06e648608b42e375679dc0))

## 0.6.1

### Patch Changes

- 4920103: installDirectory and searchPath read the platform, handlerIn reads handlerDirectory ([`8848623`](https://github.com/briancray/abide/commit/8848623ae50b5827cbde50add0b0f1a03c6f7db1))

## 0.6.0

### Minor Changes

- f35c47f: A link can ask for MCP tools of the visitor's own servers. The bridge finds them in the visitor's Claude Code configuration (user scope) or in the `--mcp-config` they passed, reads them again every turn, and gives a turn only the servers of the tools it was granted (44.15, 44.58). It reports to the site which asked-for tools it cannot give (44.61). The Allow dialog names any tool whose server the visitor lacks (44.65), and offers Always Allow: kept per site and per holder of the code, so a code minted for someone else is still asked about (44.62). `abide-bridge forget [<site>]` makes a site ask again (44.66). `abide-bridge install` now registers on Linux (a desktop entry, asking with `zenity` or `kdialog`) and Windows (registry classes) as well as macOS (44.43, 44.64). Reinstall once to get the new link handler: an older one refuses a link carrying MCP tool names.

## 0.5.2

### Patch Changes

- ccbee47: the bridge trusts the authorities this machine trusts as well as bun's own, so it pairs with a site whose certificate an organization's authority signed — 44.47

## 0.5.1

### Patch Changes

- 0e5f83e: a bridge ends a turn the site missed part of and reports it failed, says a lost site once, and speaks in shorter notifications (RULEBOOK 44.24, 44.45, 44.46) ([`ad9706e`](https://github.com/briancray/abide/commit/ad9706ee850811219c29cd58fe5289219da93c61))

## 0.5.0

### Minor Changes

- efef999: `abide-bridge install` keeps `--env NAME=VALUE` and the Claude Code options after its `--`, and every pairing link it opens runs with them — naming them in the question it asks first (RULEBOOK 44.42, 44.44)

## 0.4.0

### Minor Changes

- 2af648d: a pairing link beside the command — abide-bridge install registers a macOS app that opens it and asks before it pairs (RULEBOOK 44.40-44.43) ([`409d5ac`](https://github.com/briancray/abide/commit/409d5ac7f95338cb3f44a21cc76cd977387eab42))

## 0.3.5

### Patch Changes

- a9f8ad1: format the repo with abide format and bun fmt ([`d7cd46d`](https://github.com/briancray/abide/commit/d7cd46da1e0cd523631d38d923f8bb08d1f0716f))

## 0.3.4

### Patch Changes

- 48cfc3e: multimodal transcripts — an `AssistantMessage`'s `content` is its words or its pieces in order, each `AssistantContent` text or an image as base64 with its type. `assistant` refuses an image a model can't take or one outside a user turn, and hands a `Provider` every turn as its pieces, words alone as one text piece. `claudeApi` shows each image to the model as an image block in its place, and `claudeCode` sends the one message Claude Code is sent as Messages API blocks, each image in its place. RULEBOOK 44.5, 44.36, 44.37, 44.38, 44.39

## 0.3.3

### Patch Changes

- f9b3789: a request is never reaped by the idle timeout while it is being answered, an idle connection is reaped after 10 seconds, and every event stream beats every 15 seconds ([`14eea6e`](https://github.com/briancray/abide/commit/14eea6e7ae0b72eb194c16e17ca4e7c4498baf46))

## 0.3.2

### Patch Changes

- fda92c3: a site holds a dropped bridge pairing for 60 seconds, past when the bridge notices a silent drop ([`ac8e1d3`](https://github.com/briancray/abide/commit/ac8e1d313b7ea54414cd1034b56eb4cfa88ab31b))

## 0.3.1

### Patch Changes

- cc6f899: a bridge stopped by SIGTERM, SIGINT or SIGHUP ends every Claude Code run it started before it exits ([`5847a59`](https://github.com/briancray/abide/commit/5847a59e0de0d45ed1ea11b526fda27c24490ebc))

## 0.3.0

### Minor Changes

- bd2a74f: Breaking: an assistant announces a tool call as the model starts writing it, and a site may ask the visitor's Claude Code for built-in tools ([`c959804`](https://github.com/briancray/abide/commit/c959804fd19c3e99fe439f3f1120f1ef13f42ff8))

## 0.2.0

### Minor Changes

- 9aa03a5: socket mux bounds, request ceilings, stop timeout, scroll restore, numeric and composed bind:value, and keyed rows kept across patches (16.78, 18.28-18.32, 30.29-30.31, 32.58-32.62, 32.66, 32.67, 42.17) ([`301bf47`](https://github.com/briancray/abide/commit/301bf47adf5059271b439fe3c129963861dd1c72))
