---
"@abide/abide": minor
---

`onLauncher` takes `dock: 'window'` beside `menuBarExtra: true`: the Dock icon and the menu bar come and go with the window, and Quit in the application menu closes the window and leaves the app in the menu bar, where the menu bar extra's own Quit still stops it through `App.stop` (RULEBOOK 38.183-38.185). An `onLauncher` refusal names the clause it breaks rather than always 38.81
