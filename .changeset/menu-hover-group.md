---
"@abide/abide": minor
---

`menu` takes `openOnHover` (milliseconds a mouse or pen rests on the trigger before it opens; a touch never hovers), `closeOnLeave` (milliseconds after the pointer leaves trigger and menu before a pointer-opened menu closes; one a key opened stays) and `group` (menus sharing a name switch between each other: the pointer on another's trigger while one is open, or ArrowLeft and ArrowRight). A menu a group switches to carries `data-from` and the one it left `data-to`, the side the other stands on, for a transition (RULEBOOK 50.57-50.60).
