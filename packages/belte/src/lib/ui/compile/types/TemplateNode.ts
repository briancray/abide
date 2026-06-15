import type { TemplateAttr } from './TemplateAttr.ts'
import type { TextPart } from './TextPart.ts'

/*
A parsed template node. `text` carries interpolation parts; `element` carries
attributes and children; `each` is the `<template each as key>` control flow over
a list. (if/await/switch are future siblings.)
*/
export type TemplateNode =
    | { kind: 'text'; parts: TextPart[] }
    | { kind: 'element'; tag: string; attrs: TemplateAttr[]; children: TemplateNode[] }
    | { kind: 'each'; items: string; as: string; key: string | undefined; children: TemplateNode[] }
    | { kind: 'if'; condition: string; children: TemplateNode[] }
    | { kind: 'await'; promise: string; children: TemplateNode[] }
    | { kind: 'branch'; branch: 'then' | 'catch'; as: string | undefined; children: TemplateNode[] }
    | { kind: 'component'; name: string; props: { name: string; code: string }[] }
