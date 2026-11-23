---
"@abide/abide": minor
---

`calendar({ month, selected, firstDay, locale, timeZone })` is WAI-ARIA's date grid as parts an app spreads onto markup of its own: the whole weeks a month falls in, a header cell per weekday named in the locale, a cell per day carrying `data-today`, `data-outside` and `data-selected`, the month's heading and the buttons paging it. Days are `YYYY-MM-DD` strings counted on UTC's calendar, so a daylight-saving change drops or repeats none and a server render matches the page it hydrates; a week starts on the locale's first day; the arrows, Home, End, Page Up and Page Down move through the days and the months (RULEBOOK 52.82-52.95).
