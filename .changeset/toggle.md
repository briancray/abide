---
"@abide/abide": minor
---

`toggle` and `toggleGroup`, two parts functions for buttons that hold a choice. `toggle()` is a button that stays pressed — `aria-pressed`, or an on/off switch with `role: 'switch'` — and hands back `pressed` to read and write (51.108, 51.109). `toggleGroup({ keys })` picks one key as a radio group, the arrow keys moving the pick and focus together with one stop in the tab order — a segmented control (51.111-51.114); with `multiple: true` it is a `toggle` per key, each pressed while `value` holds it — filter chips (51.110).
