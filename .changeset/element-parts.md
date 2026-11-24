---
"@abide/abide": minor
---

`observe` is three parts named for what each measures, and their options and `format`'s take the web platform's own names (RULEBOOK 32.79-32.92, 32.110, 32.112, 52.35, 52.112):

- `observe.size(x, options)` → `elementSize(x, options)`; `box: 'content' | 'border'` → `box: 'content-box' | 'border-box'`, and `'device-pixel-content-box'` writes the size in device pixels.
- `observe.visible(x, options)` → `elementVisible(x, options)`; `in: root` → `root: root`, and `IntersectionObserver`'s `rootMargin` and `threshold` pass through — in view from the smallest share `threshold` names.
- `observe.rect(x)` → `elementRect(x)`.
- The part each spreads is marked `data-element-size`, `data-element-visible` or `data-element-rect` where it was `data-observe`.
- `format.money`, `format.percent` and `format.number` take `Intl.NumberFormat`'s options: `digits: n` → `minimumFractionDigits: n, maximumFractionDigits: n` (or `maximumFractionDigits` alone to drop trailing zeros), `compact: true` → `notation: 'compact'`, `signed: true` → `signDisplay: 'exceptZero'`. `format.bytes` takes `minimumFractionDigits` / `maximumFractionDigits` for `digits`. `format.list`'s `conjunction: 'or'` → `type: 'disjunction'`, and `style` passes through. `format.relative` takes `numeric`.
