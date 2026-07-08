import ts from 'typescript'
import { assignmentTargetNames } from './assignmentTargetNames.ts'
import { isPlainIdentifier } from './isPlainIdentifier.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
Every name the TEMPLATE writes — the counterpart to the leading script's own write
scan. Two ways a prop's name shows up written in markup:
  • forwarded as a `bind:` target — `bind:value={value}` on a child element or component
    passes the name as a two-way target, so it must be a writable cell (a bare identifier
    only; a `{ get, set }` accessor carries its own write path and reads the prop plainly);
  • assigned in a template expression — an event handler like `onclick={() => value += 1}`.

Collected across every JS fragment the markup carries (attribute/prop/event/text
expressions and nested `<script>` bodies), then intersected with the actual prop names by
the caller. Syntactic and conservative — see `assignmentTargetNames`.
*/
export function writtenTemplateNames(nodes: TemplateNode[]): Set<string> {
    const names = new Set<string>()
    /* One synthetic source of every expression fragment, parsed once for its write targets. */
    let fragments = ''
    const addFragment = (code: string | undefined): void => {
        if (code !== undefined && code.trim() !== '') {
            fragments += `${code};\n`
        }
    }
    /* A bare-identifier `bind:` target names a prop forwarded as a two-way channel. */
    const addBindTarget = (code: string): void => {
        if (isPlainIdentifier(code.trim())) {
            names.add(code.trim())
        }
    }
    const walk = (node: TemplateNode): void => {
        if (node.kind === 'text') {
            for (const part of node.parts) {
                if (part.kind === 'expression') {
                    addFragment(part.code)
                }
            }
            return
        }
        if (node.kind === 'script') {
            addFragment(node.code)
            return
        }
        if (node.kind === 'element') {
            for (const attr of node.attrs) {
                if (attr.kind === 'bind') {
                    addBindTarget(attr.code)
                    addFragment(attr.code)
                } else if (attr.kind === 'interpolated') {
                    for (const part of attr.parts) {
                        if (part.kind === 'expression') {
                            addFragment(part.code)
                        }
                    }
                } else if (attr.kind !== 'static') {
                    addFragment(attr.code)
                }
            }
        }
        if (node.kind === 'component') {
            for (const prop of node.props) {
                if (prop.bind === true) {
                    addBindTarget(prop.code)
                }
                addFragment(prop.code)
            }
        }
        if ('children' in node) {
            for (const child of node.children) {
                walk(child)
            }
        }
    }
    for (const node of nodes) {
        walk(node)
    }
    if (fragments.trim() !== '') {
        const source = ts.createSourceFile('template.ts', fragments, ts.ScriptTarget.Latest, true)
        assignmentTargetNames(source, names)
    }
    return names
}
