import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { anchorCursor } from '../src/lib/ui/dom/anchorCursor.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { cloneStatic } from '../src/lib/ui/dom/cloneStatic.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { skeleton } from '../src/lib/ui/dom/skeleton.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
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
let flag = state(true)
</script>
<nav>
  <template each={groups} as="group" key="group.title">
    <div>
      <h2>{group.title}</h2>
      <ul>
        <template each={group.links} as="link" key="link">
          <li>{link}</li>
        </template>
      </ul>
    </div>
  </template>
  <template if={flag}>
    <footer>tail</footer>
  </template>
</nav>
`

describe('nested each hydrate', () => {
    test('skeleton collects only its OWN anchors, not nested block anchors', () => {
        const server = new Function('doc', 'state', 'derived', 'effect', compileSSR(SRC))(
            doc,
            state,
            derived,
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
        const server = new Function('doc', 'state', 'derived', 'effect', compileSSR(SRC))(
            doc,
            state,
            derived,
            effect,
        ) as SsrRender
        const host = document.createElement('div')
        host.innerHTML = server.html

        const runtime = {
            doc,
            state,
            derived,
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
            let label = state('go')
            </script>
            <section>
              <template each={[1,2]} as="n" key="n"><i>{n}</i></template>
              <button class={label}>x</button>
            </section>
        `
        const server = new Function('doc', 'state', 'derived', 'effect', compileSSR(src))(
            doc,
            state,
            derived,
            effect,
        ) as SsrRender
        const host = document.createElement('div')
        host.innerHTML = server.html

        const runtime = {
            doc,
            state,
            derived,
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
})
