---
"@abide/abide": patch
---

`observe.size`, `observe.rect` and the placement of an open hint or menu share one `ResizeObserver`, where they made one each: a frame in which several resize is one batch of deliveries (RULEBOOK 32.81, 32.98).
