---
"@abide/abide": minor
---

`scrollSpy` marks the section of a long page scrolled to, as parts spread onto a nav of links: give each section an `id` that is its item's key, spread `host` on the nav and `jump(item)` on a link per section. Each link is a real `href="#key"`, and a click scrolls as `behavior` names to where the browser would land the section — its `scroll-margin-top` and the scroller's `scroll-padding-top` counted, so a sticky header is said once in CSS — and writes the fragment. The first section is current at the top and the last at the end of the scroller; offsets are measured a frame after binding and whenever something holding a section resizes, so a scroll reads no layout (RULEBOOK 51.169-51.177).

`scrub` on `scrollSpy` and on `virtualList` turns the jumps into an alphabet scroller: a press dragged along them clicks each jump it reaches once, past disabled ones, with `data-scrubbing` on the host meanwhile (51.167, 51.168).

BREAKING: `VirtualListSections` is now `Sections<VirtualListSection>` — the one jump index type `virtualList.sections` and `scrollSpy` both hand back.
