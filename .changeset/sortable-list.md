---
"@abide/abide": minor
---

`sortableList({ items, key, label, multiple })`, a `listbox` put in order by hand: spread `list`, each `item(entry).item`, and a grip on each as `.handle`. The list is one stop in the tab order whose keys and selection are the listbox's — click, ⌘ or Ctrl click, Shift click, ⌘A and Shift with the arrows — and Alt with ArrowUp or ArrowDown moves the active item, or the whole selection where it is in it, a place at a time. A grip dragged places its item, or the selection it is in, among the others by the pointer. Each move is read out through `announce`. `sorted` is the items in the order put, `order` their keys, and `selected` the listbox's (51.145-51.151).
