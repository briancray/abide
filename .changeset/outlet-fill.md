---
"@abide/abide": minor
---

`Outlet` and `fill` (`import Outlet, { fill } from '@abide/abide/Outlet.abide'`): a layout leaves a named place with `<Outlet name="actions" />`, and a page, a layout or a component below it hands a component to it with `fill('actions', Component, props)`, rendered there in the order the fills were made for as long as the setup that made each stands. A fill made in a page's or a layout's setup is painted by the server inside the outlet and adopted there by hydration; of two outlets under one name the last renders; a fill no outlet of its name stood for warns once on `abide:fill` (RULEBOOK 35.20-35.24).
