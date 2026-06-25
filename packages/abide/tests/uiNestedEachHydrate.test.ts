import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { anchorCursor } from '../src/lib/ui/dom/anchorCursor.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { cloneStatic } from '../src/lib/ui/dom/cloneStatic.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { skeleton } from '../src/lib/ui/dom/skeleton.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { RENDER } from '../src/lib/ui/runtime/RENDER.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* A skeleton with a nested each (each group → its own each over links) followed by a
   sibling block — exactly the kitchen-sink sidebar shape that surfaced the bug: the
   menu's first group's links flashed then were replaced by the trailing block's
   content. The skeleton owns two nav-level anchors (the outer each, the `if`); the
   inner each's anchors belong to the per-row div skeletons. */
const SRC = `
<script>
const groups = [
  { title: 'A', links: ['a1','a2'] },
  { title: 'B', links: ['b1','b2'] },
]
let flag = scope().state(true)
</script>
<nav>
  {#for group of groups by group.title}
    <div>
      <h2>{group.title}</h2>
      <ul>
        {#for link of group.links by link}
          <li>{link}</li>
        {/for}
      </ul>
    </div>
  {/for}
  {#if flag}
    <footer>tail</footer>
  {/if}
</nav>
`

describe('nested each hydrate', () => {
    test('skeleton collects only its OWN anchors, not nested block anchors', () => {
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(SRC))(
            doc,
            state,
            computed,
            effect,
        ) as SsrRender
        const host = document.createElement('div')
        host.innerHTML = server.html

        /* Claim the nav skeleton against the EXPANDED server DOM. Its two structural
           anchors (outer each + `if`) must come back — not the inner each anchors the
           expanded rows carry inline, which would shift `an[1]` onto group A's <ul>. */
        const previous = RENDER.hydration
        RENDER.hydration = { next: new Map() }
        const sk = skeleton(host, '<nav><!--a--><!--a--></nav>')
        RENDER.hydration = previous
        expect(sk.an.length).toBe(2)
    })

    test('hydrates with every group keeping its links and the trailing block last', () => {
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(SRC))(
            doc,
            state,
            computed,
            effect,
        ) as SsrRender
        const host = document.createElement('div')
        host.innerHTML = server.html

        const runtime = {
            doc,
            state,
            computed,
            effect,
            appendText,
            each,
            skeleton,
            anchorCursor,
            when,
            cloneStatic,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        const body = compileComponent(SRC)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        expect(host.textContent.replace(/\s+/g, ' ').trim()).toBe('Aa1a2Bb1b2tail')
    })

    /* An element hole (the button's reactive `class`) positioned AFTER a block at the same
       parent level. The compiler indexes it over the shallow template (el[0]); the expanded
       SSR puts the each rows' <i> elements before it, so the element-only path must skip that
       inline block content or `class` binds to the first row's <i> instead of the button. */
    test('resolves an element hole positioned after a block (skips inline block elements)', () => {
        const src = `
            <script>
            let label = scope().state('go')
            </script>
            <section>
              {#for n of [1,2] by n}<i>{n}</i>{/for}
              <button class={label}>x</button>
            </section>
        `
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(src))(
            doc,
            state,
            computed,
            effect,
        ) as SsrRender
        const host = document.createElement('div')
        host.innerHTML = server.html

        const runtime = {
            doc,
            state,
            computed,
            effect,
            appendText,
            attr,
            each,
            skeleton,
            anchorCursor,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        hydrate(host, (target) => {
            new Function('host', ...names, compileComponent(src))(target, ...values)
        })

        const section = host.childNodes[0] as unknown as { childNodes: { tagName?: string }[] }
        const button = section.childNodes.find((n) => n.tagName === 'button') as unknown as {
            getAttribute: (name: string) => string | null
        }
        const firstRow = section.childNodes.find((n) => n.tagName === 'i') as unknown as {
            getAttribute: (name: string) => string | null
        }
        // the class bound to the button, NOT to the first each row's <i>
        expect(button.getAttribute('class')).toBe('go')
        expect(firstRow.getAttribute('class')).toBe(null)
    })

    test('an each with index="i" renders the position server-side and hydrates congruently', () => {
        const src = `
            <script>
            const items = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
            </script>
            <ul>
              {#for item, i of items by item.id}<li>{i}:{item.label}</li>{/for}
            </ul>
        `
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(src))(
            doc,
            state,
            computed,
            effect,
        ) as SsrRender
        // The server renders the indices, so a resume/hydrate adopts them (no client flash).
        const serverText = server.html.replace(/<!--.*?-->/g, '').replace(/\s+/g, '')
        expect(serverText).toContain('0:a')
        expect(serverText).toContain('1:b')

        const host = document.createElement('div')
        host.innerHTML = server.html
        const runtime = {
            doc,
            state,
            computed,
            effect,
            appendText,
            appendStatic,
            each,
            skeleton,
            anchorCursor,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        const body = compileComponent(src)
        // A desync between the server's plain index and the client's cell read would throw
        // `claimExpected`; congruence means the same text survives hydration unchanged.
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })
        expect(host.textContent.replace(/\s+/g, '')).toBe('0:a1:b')
    })
})
