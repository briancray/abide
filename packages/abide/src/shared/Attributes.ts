// 33.23 — WHAT AN ELEMENT TAKES, AS A COMPONENT'S PROPS, for a component that spreads the rest of its
// props onto one: `props<{ size?: Size } & Attributes<'button'>>()` holds a caller to the attributes
// a `<button>` has, and types `onclick`'s event.
//
// DERIVED FROM THE DOM TYPES TypeScript ships rather than written out per element, so it moves when
// they do: every writable property of the element that is not a method or a node is an attribute,
// under its HTML spelling. What the DOM types say and what an attribute is part company in four
// places, and each is named below rather than guessed — a value is written as text (32.37), so the
// property's type is widened to what writes the same attribute; and an attribute with no property,
// or a property that is not the attribute, is added by hand.

import type { BooleanAttribute } from './BOOLEAN_ATTRIBUTES.ts'

/**
 * The element's properties an attribute sets: writable, and neither a method nor a node.
 *
 * NAMED KEYS ONLY. A form indexes its controls by name and a select its options by position, and an
 * index signature mapped as an attribute typed every attribute a caller passed as whatever it held.
 * Taken through a remapping, which keeps the named keys where `keyof` alone collapses them into the
 * index's `string`.
 */
type Reflected<Element> = {
    [Key in Named<Element>]-?: Element[Key] extends (
        ...given: never[]
    ) => unknown
        ? never
        : Element[Key] extends
                | Node
                | NodeList
                | HTMLCollection
                | DOMTokenList
                | CSSStyleDeclaration
                | DOMStringMap
                | readonly Element[]
                | null
          ? never
          : (<Same>() => Same extends { [K in Key]: Element[Key] }
                  ? 1
                  : 2) extends <Same>() => Same extends {
                  -readonly [K in Key]: Element[Key]
              }
                  ? 1
                  : 2
            ? Key
            : never
}[Named<Element>]

/** `Element`'s keys without its index signatures. */
type Named<Element> = keyof {
    [
        Key in keyof Element as string extends Key
            ? never
            : number extends Key
              ? never
              : Key
    ]: Element[Key]
}

/** The properties whose attribute is not their name lowercased. */
type Renamed = {
    className: 'class'
    htmlFor: 'for'
    httpEquiv: 'http-equiv'
    acceptCharset: 'accept-charset'
}

/** A property's attribute: renamed, `ariaLabel` as `aria-label`, or lowercased. */
type AttributeName<Key> = Key extends keyof Renamed
    ? Renamed[Key]
    : Key extends `aria${infer Rest}`
      ? `aria-${Lowercase<Rest>}`
      : Lowercase<Key & string>

/**
 * What writes the attribute a property's type stands for (32.37).
 *
 * An attribute HTML reads by presence takes a boolean. Every other boolean is written as its text,
 * so `"true"` and `"false"` write it too, and a number is written as its digits. `aria-*` is text
 * the DOM types spell as a string, which a boolean or a number writes as well. `autocomplete`'s
 * token list is suggested rather than enforced: it is open-ended by the standard.
 */
type Written<Name, Value> = Name extends `aria-${string}`
    ? string | number | boolean
    : Name extends 'autocomplete'
      ? Value | (string & {})
      : [Value] extends [boolean]
        ? Name extends BooleanAttribute
            ? boolean
            : boolean | 'true' | 'false'
        : [Value] extends [number]
          ? number | `${number}`
          : Value

/** Attributes some element has that no writable property of it reflects. */
type Unreflected<Tag> = (Tag extends
    | 'button'
    | 'fieldset'
    | 'input'
    | 'object'
    | 'output'
    | 'select'
    | 'textarea'
    ? { form?: string }
    : unknown) &
    (Tag extends 'input' ? { list?: string } : unknown)

/**
 * The attributes element `Tag` takes, typed as a component's props: a caller passing them is held to
 * what the element takes, and its listeners are handed that element's events.
 *
 * 33.26 — AN SVG ELEMENT TAKES THE SVG ATTRIBUTES. A tag both namespaces name — `a`, `script`,
 * `style`, `title` — is the HTML element, which is what it is outside an `<svg>`.
 */
export type Attributes<
    Tag extends keyof HTMLElementTagNameMap | keyof SVGElementTagNameMap,
> = Tag extends keyof HTMLElementTagNameMap
    ? HtmlAttributes<Tag>
    : Tag extends keyof SVGElementTagNameMap
      ? SvgAttributes<Tag>
      : never

/** An HTML element's attributes, derived from what its DOM type reflects. */
type HtmlAttributes<Tag extends keyof HTMLElementTagNameMap> = {
    [
        Key in Reflected<
            HTMLElementTagNameMap[Tag]
        > as Key extends `on${string}` ? never : AttributeName<Key>
    ]?: Written<
        AttributeName<Key>,
        NonNullable<HTMLElementTagNameMap[Tag][Key]>
    > | null
} & {
    [Event in keyof HTMLElementEventMap as `on${Event}`]?: (
        event: HTMLElementEventMap[Event] & {
            currentTarget: HTMLElementTagNameMap[Tag]
        },
    ) => unknown
} & Unreflected<Tag> &
    Global & {
        itemscope?: boolean
        itemtype?: string
        itemprop?: string
        itemid?: string
        itemref?: string
    }

/**
 * An SVG element's attributes: one set for every SVG element, as written out below.
 *
 * WRITTEN OUT RATHER THAN DERIVED. An SVG element's DOM type reflects its attributes as read-only
 * animated values — `cx` is an `SVGAnimatedLength` — so the derivation an HTML element is typed by
 * finds almost none of them. One set for every element is what the SVG specification's own
 * presentation attributes are, and the geometry a given element ignores is harmless where it is
 * written. A length or a number is written as its text (32.37), so each takes either.
 */
type SvgAttributes<Tag extends keyof SVGElementTagNameMap> = {
    [Name in SvgAttribute]?: string | number | null
} & {
    [Event in keyof SVGElementEventMap as `on${Event}`]?: (
        event: SVGElementEventMap[Event] & {
            currentTarget: SVGElementTagNameMap[Tag]
        },
    ) => unknown
} & Global & {
        id?: string
        lang?: string
        tabindex?: number | `${number}` | null
        role?: string
    }

/** Attributes every element takes that no reflected property types. */
type Global = {
    class?: string
    style?: string
    [data: `data-${string}`]: unknown
    [aria: `aria-${string}`]: string | number | boolean | null | undefined
}

/** The SVG attributes, presentation attributes included, under the names SVG spells them. */
type SvgAttribute =
    // Presentation attributes, which a stylesheet can set as well.
    | 'alignment-baseline'
    | 'baseline-shift'
    | 'clip-path'
    | 'clip-rule'
    | 'color'
    | 'color-interpolation'
    | 'color-interpolation-filters'
    | 'cursor'
    | 'direction'
    | 'display'
    | 'dominant-baseline'
    | 'fill'
    | 'fill-opacity'
    | 'fill-rule'
    | 'filter'
    | 'flood-color'
    | 'flood-opacity'
    | 'font-family'
    | 'font-size'
    | 'font-size-adjust'
    | 'font-stretch'
    | 'font-style'
    | 'font-variant'
    | 'font-weight'
    | 'image-rendering'
    | 'letter-spacing'
    | 'lighting-color'
    | 'marker-end'
    | 'marker-mid'
    | 'marker-start'
    | 'mask'
    | 'mask-type'
    | 'opacity'
    | 'overflow'
    | 'paint-order'
    | 'pointer-events'
    | 'shape-rendering'
    | 'stop-color'
    | 'stop-opacity'
    | 'stroke'
    | 'stroke-dasharray'
    | 'stroke-dashoffset'
    | 'stroke-linecap'
    | 'stroke-linejoin'
    | 'stroke-miterlimit'
    | 'stroke-opacity'
    | 'stroke-width'
    | 'text-anchor'
    | 'text-decoration'
    | 'text-rendering'
    | 'transform'
    | 'transform-origin'
    | 'unicode-bidi'
    | 'vector-effect'
    | 'visibility'
    | 'white-space'
    | 'word-spacing'
    | 'writing-mode'
    // The document and its viewport.
    | 'xmlns'
    | 'version'
    | 'viewBox'
    | 'preserveAspectRatio'
    | 'focusable'
    // Geometry.
    | 'x'
    | 'y'
    | 'x1'
    | 'y1'
    | 'x2'
    | 'y2'
    | 'cx'
    | 'cy'
    | 'r'
    | 'rx'
    | 'ry'
    | 'fx'
    | 'fy'
    | 'fr'
    | 'width'
    | 'height'
    | 'd'
    | 'points'
    | 'pathLength'
    | 'href'
    // Text.
    | 'dx'
    | 'dy'
    | 'rotate'
    | 'textLength'
    | 'lengthAdjust'
    | 'startOffset'
    | 'method'
    | 'spacing'
    // Paint servers, clips, masks and markers.
    | 'offset'
    | 'gradientUnits'
    | 'gradientTransform'
    | 'spreadMethod'
    | 'patternUnits'
    | 'patternContentUnits'
    | 'patternTransform'
    | 'clipPathUnits'
    | 'maskUnits'
    | 'maskContentUnits'
    | 'markerUnits'
    | 'markerWidth'
    | 'markerHeight'
    | 'refX'
    | 'refY'
    | 'orient'
    // Filters.
    | 'filterUnits'
    | 'primitiveUnits'
    | 'in'
    | 'in2'
    | 'result'
    | 'mode'
    | 'type'
    | 'values'
    | 'operator'
    | 'stdDeviation'
    | 'k1'
    | 'k2'
    | 'k3'
    | 'k4'
    | 'scale'
    | 'xChannelSelector'
    | 'yChannelSelector'
    | 'baseFrequency'
    | 'numOctaves'
    | 'seed'
    | 'stitchTiles'
    | 'surfaceScale'
    | 'diffuseConstant'
    | 'specularConstant'
    | 'specularExponent'
    | 'azimuth'
    | 'elevation'
    | 'tableValues'
    | 'slope'
    | 'intercept'
    | 'amplitude'
    | 'exponent'
    // Animation.
    | 'attributeName'
    | 'begin'
    | 'dur'
    | 'end'
    | 'repeatCount'
    | 'repeatDur'
    | 'restart'
    | 'from'
    | 'to'
    | 'by'
    | 'keyTimes'
    | 'keySplines'
    | 'calcMode'
    | 'additive'
    | 'accumulate'
    | 'path'
    | 'keyPoints'
