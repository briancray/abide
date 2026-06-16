import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import type { SwitchCase } from './types/SwitchCase.ts'

/*
Multi-branch binding — the runtime for `<template switch>`. An effect evaluates
the subject, picks the first case whose `match` equals it (strict `===`), falling
back to the default (`match` undefined); the chosen branch renders in its own
scope, anchored for placement. A branch is a RANGE of element roots, tracked as a
node array so a multi-root case inserts/removes as a unit. Staying on the same
branch across a subject change leaves it mounted; switching disposes the old.

On hydrate it adopts the case the server rendered (in place) and anchors after it;
the effect's first run picks the same case and is a no-op, later changes swap fresh.
*/
// @readme plumbing
export function switchBlock(parent: Node, subject: () => unknown, cases: SwitchCase[]): void {
    const hydration = RENDER.hydration
    let active: { nodes: Node[]; dispose: () => void } | undefined
    let activeIndex = -1
    let anchor: Node

    const build = (chosen: SwitchCase): { nodes: Node[]; dispose: () => void } => {
        let nodes: Node[] = []
        const dispose = scope(() => {
            nodes = chosen.render(parent)
        })
        return { nodes, dispose }
    }

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
            active = build(chosen)
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
            for (const node of active.nodes) {
                parent.removeChild(node)
            }
            active = undefined
        }
        activeIndex = index
        const chosen = index === -1 ? undefined : cases[index]
        if (chosen === undefined) {
            return
        }
        active = build(chosen)
        for (const node of active.nodes) {
            parent.insertBefore(node, anchor)
        }
    })
}
