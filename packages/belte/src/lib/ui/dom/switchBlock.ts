import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'
import type { SwitchCase } from './types/SwitchCase.ts'

/*
Multi-branch binding — the runtime for `<template switch>`. An effect evaluates
the subject, picks the first case whose `match` equals it (strict `===`), falling
back to the default (`match` undefined); the chosen branch renders in its own
scope, anchored for placement. Staying on the same branch across a subject change
leaves it mounted; switching disposes the old and mounts the new.

On hydrate it adopts the case the server rendered (in place) and anchors after it;
the effect's first run picks the same case and is a no-op, later changes swap fresh.
*/
// @readme plumbing
export function switchBlock(parent: Node, subject: () => unknown, cases: SwitchCase[]): void {
    const hydration = RENDER.hydration
    let active: EachRow | undefined
    let activeIndex = -1
    let anchor: Node

    const select = (value: unknown): number => {
        const matched = cases.findIndex(
            (entry) => entry.match !== undefined && entry.match() === value,
        )
        return matched === -1 ? cases.findIndex((entry) => entry.match === undefined) : matched
    }

    if (hydration !== undefined) {
        activeIndex = select(subject())
        const chosen = activeIndex === -1 ? undefined : cases[activeIndex]
        if (chosen !== undefined) {
            let node: Node | undefined
            const dispose = scope(() => {
                node = chosen.render(parent)
            })
            active = { node: node as Node, dispose }
        }
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, claimChild(hydration, parent))
    } else {
        anchor = document.createTextNode('')
        parent.appendChild(anchor)
    }

    effect(() => {
        const index = select(subject())
        if (index === activeIndex) {
            return
        }
        if (active !== undefined) {
            active.dispose()
            parent.removeChild(active.node)
            active = undefined
        }
        activeIndex = index
        const chosen = index === -1 ? undefined : cases[index]
        if (chosen === undefined) {
            return
        }
        let node: Node | undefined
        const dispose = scope(() => {
            node = chosen.render(parent)
        })
        active = { node: node as Node, dispose }
        parent.insertBefore(active.node, anchor)
    })
}
