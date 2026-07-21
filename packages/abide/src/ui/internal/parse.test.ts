import { describe, expect, test } from 'bun:test'
import type {
    AwaitBlock,
    Component,
    Element,
    ForBlock,
    Html,
    IfBlock,
    Interpolation,
    Script,
    Style,
    SwitchBlock,
    TemplateNode,
    TryBlock,
} from './ast.ts'
import { ParseError, parse } from './parse.ts'

// Convenience: parse and return the root children.
function children(source: string): TemplateNode[] {
    return parse(source).children
}

// Convenience: parse a source expected to yield a single significant node (ignoring whitespace text).
function only<T extends TemplateNode>(source: string): T {
    const significant = children(source).filter(
        (node) => !(node.type === 'Text' && node.value.trim() === ''),
    )
    expect(significant.length).toBe(1)
    return significant[0] as T
}

// Convenience: index into an array, asserting the element exists (preserves crash-on-missing).
function at<T>(list: readonly T[], index: number): T {
    const value = list[index]
    if (value === undefined) throw new Error(`expected an element at index ${index}`)
    return value
}

// Convenience: assert a nullable value is present (preserves crash-on-null).
function present<T>(value: T | null | undefined, what: string): T {
    if (value == null) throw new Error(`expected ${what} to be present`)
    return value
}

describe('text and interpolation', () => {
    test('plain text', () => {
        const node = only<TemplateNode>('hello world')
        expect(node.type).toBe('Text')
        expect((node as { value: string }).value).toBe('hello world')
    })

    test('reactive interpolation', () => {
        const node = only<Interpolation>('{count}')
        expect(node.type).toBe('Interpolation')
        expect(node.expression).toBe('count')
    })

    test('interpolation trims surrounding whitespace', () => {
        const node = only<Interpolation>('{  a + b  }')
        expect(node.expression).toBe('a + b')
    })

    test('text, interpolation, text sequence', () => {
        const nodes = children('Hi {name}!')
        expect(nodes.map((n) => n.type)).toEqual(['Text', 'Interpolation', 'Text'])
    })

    test('lone `<` in text is not a tag', () => {
        const node = only<TemplateNode>('a < b')
        expect(node.type).toBe('Text')
        expect((node as { value: string }).value).toBe('a < b')
    })

    test('html() raw injection', () => {
        const node = only<Html>('{html(markup)}')
        expect(node.type).toBe('Html')
        expect(node.expression).toBe('markup')
    })

    test('html() with a nested call argument', () => {
        const node = only<Html>('{html(render(x, y))}')
        expect(node.type).toBe('Html')
        expect(node.expression).toBe('render(x, y)')
    })

    test('expression beginning with html( but not a pure call stays interpolation', () => {
        const node = only<Interpolation>('{html(x) + suffix}')
        expect(node.type).toBe('Interpolation')
        expect(node.expression).toBe('html(x) + suffix')
    })

    test('inline await interpolation', () => {
        const node = only<TemplateNode>('{await user()}')
        expect(node.type).toBe('AwaitInterpolation')
        expect((node as { expression: string }).expression).toBe('user()')
    })

    test('identifier starting with await is not an await interpolation', () => {
        const node = only<Interpolation>('{awaiting}')
        expect(node.type).toBe('Interpolation')
        expect(node.expression).toBe('awaiting')
    })

    test('slot and snippet calls parse as interpolations', () => {
        expect(only<Interpolation>('{children()}').expression).toBe('children()')
        expect(only<Interpolation>('{row(item)}').expression).toBe('row(item)')
    })
})

describe('brace balancing inside expressions', () => {
    test('object literal', () => {
        expect(only<Interpolation>('{ {a: 1, b: 2} }').expression).toBe('{a: 1, b: 2}')
    })

    test('nested object', () => {
        expect(only<Interpolation>('{ {a: {b: {c: 1}}} }').expression).toBe('{a: {b: {c: 1}}}')
    })

    test('ternary', () => {
        expect(only<Interpolation>('{ ok ? yes : no }').expression).toBe('ok ? yes : no')
    })

    test('template literal with interpolation containing a brace', () => {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal template-syntax data
        const node = only<Interpolation>('{ `a ${ {x:1}.x } b` }')
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal template-syntax data
        expect(node.expression).toBe('`a ${ {x:1}.x } b`')
    })

    test('string containing a closing brace', () => {
        expect(only<Interpolation>('{ "}" + close }').expression).toBe('"}" + close')
    })

    test('array and call parens', () => {
        expect(only<Interpolation>('{ fn([1, 2], {k: 3}) }').expression).toBe('fn([1, 2], {k: 3})')
    })
})

describe('elements', () => {
    test('simple element with text', () => {
        const el = only<Element>('<div>hi</div>')
        expect(el.type).toBe('Element')
        expect(el.name).toBe('div')
        expect(el.selfClosing).toBe(false)
        expect(el.void).toBe(false)
        expect(el.children.map((c) => c.type)).toEqual(['Text'])
    })

    test('self-closing element', () => {
        const el = only<Element>('<div/>')
        expect(el.selfClosing).toBe(true)
        expect(el.children).toEqual([])
    })

    test('void element without slash', () => {
        const el = only<Element>('<br>')
        expect(el.void).toBe(true)
        expect(el.selfClosing).toBe(false)
        expect(el.children).toEqual([])
    })

    test('void element img with attributes', () => {
        const el = only<Element>('<img src="a.png">')
        expect(el.name).toBe('img')
        expect(el.void).toBe(true)
        expect(el.attributes.length).toBe(1)
    })

    test('nested elements', () => {
        const el = only<Element>('<ul><li>a</li><li>b</li></ul>')
        expect(el.children.filter((c) => c.type === 'Element').length).toBe(2)
    })

    test('mismatched closing tag throws', () => {
        expect(() => parse('<div></span>')).toThrow(ParseError)
    })

    test('unclosed element throws', () => {
        expect(() => parse('<div>')).toThrow(ParseError)
    })

    test('html comment', () => {
        const node = only<TemplateNode>('<!-- a comment -->')
        expect(node.type).toBe('Comment')
        expect((node as { value: string }).value).toBe(' a comment ')
    })

    test('unclosed comment throws', () => {
        expect(() => parse('<!-- oops')).toThrow(ParseError)
    })
})

describe('components vs elements by casing', () => {
    test('capitalized tag is a component', () => {
        const node = only<Component>('<Foo>x</Foo>')
        expect(node.type).toBe('Component')
        expect(node.name).toBe('Foo')
    })

    test('self-closing component', () => {
        const node = only<Component>('<Foo/>')
        expect(node.type).toBe('Component')
        expect(node.selfClosing).toBe(true)
    })

    test('dotted component name', () => {
        const node = only<Component>('<Foo.Bar/>')
        expect(node.type).toBe('Component')
        expect(node.name).toBe('Foo.Bar')
    })

    test('lowercase tag is an element', () => {
        expect(only<Element>('<section/>').type).toBe('Element')
    })
})

describe('attributes and directives', () => {
    function attrs(source: string) {
        return only<Element>(source).attributes
    }

    test('static quoted attribute', () => {
        const a = at(attrs('<div class="box">x</div>'), 0)
        expect(a.type).toBe('StaticAttribute')
        expect(a).toMatchObject({ name: 'class', value: 'box' })
    })

    test('static unquoted attribute', () => {
        const a = at(attrs('<div id=main/>'), 0)
        expect(a).toMatchObject({ type: 'StaticAttribute', name: 'id', value: 'main' })
    })

    test('boolean attribute', () => {
        const a = at(attrs('<input disabled/>'), 0)
        expect(a).toMatchObject({ type: 'StaticAttribute', name: 'disabled', value: null })
    })

    test('expression attribute', () => {
        const a = at(attrs('<div title={label}/>'), 0)
        expect(a).toMatchObject({ type: 'ExpressionAttribute', name: 'title', expression: 'label' })
    })

    test('event handler attribute', () => {
        const a = at(attrs('<button onclick={handleClick}/>'), 0)
        expect(a).toMatchObject({
            type: 'EventAttribute',
            name: 'onclick',
            event: 'click',
            expression: 'handleClick',
        })
    })

    test('oninput event handler', () => {
        const a = at(attrs('<input oninput={onType}/>'), 0)
        expect(a).toMatchObject({ type: 'EventAttribute', event: 'input' })
    })

    test('bind:value directive', () => {
        const a = at(attrs('<input bind:value={name}/>'), 0)
        expect(a).toMatchObject({ type: 'BindDirective', name: 'value', expression: 'name' })
    })

    test('bind shorthand has null expression', () => {
        const a = at(attrs('<input bind:checked/>'), 0)
        expect(a).toMatchObject({ type: 'BindDirective', name: 'checked', expression: null })
    })

    test('bind:group directive', () => {
        const a = at(attrs('<input bind:group={selected}/>'), 0)
        expect(a).toMatchObject({ type: 'BindDirective', name: 'group', expression: 'selected' })
    })

    test('bind:element directive', () => {
        const a = at(attrs('<div bind:element={node}/>'), 0)
        expect(a).toMatchObject({ type: 'BindDirective', name: 'element', expression: 'node' })
    })

    test('derived bind:value with get/set object', () => {
        const a = at(attrs('<input bind:value={{ get, set }}/>'), 0)
        expect(a).toMatchObject({
            type: 'BindDirective',
            name: 'value',
            expression: '{ get, set }',
        })
    })

    test('class directive', () => {
        const a = at(attrs('<div class:active={isActive}/>'), 0)
        expect(a).toMatchObject({ type: 'ClassDirective', name: 'active', expression: 'isActive' })
    })

    test('class directive shorthand', () => {
        const a = at(attrs('<div class:active/>'), 0)
        expect(a).toMatchObject({ type: 'ClassDirective', name: 'active', expression: null })
    })

    test('style directive', () => {
        const a = at(attrs('<div style:color={c}/>'), 0)
        expect(a).toMatchObject({ type: 'StyleDirective', name: 'color', expression: 'c' })
    })

    test('spread attribute', () => {
        const a = at(attrs('<div {...rest}/>'), 0)
        expect(a).toMatchObject({ type: 'SpreadAttribute', expression: 'rest' })
    })

    test('spread props on a component', () => {
        const a = at(only<Component>('<Foo {...props}/>').attributes, 0)
        expect(a).toMatchObject({ type: 'SpreadAttribute', expression: 'props' })
    })

    test('multiple attributes', () => {
        const list = attrs('<a href="/x" onclick={go} class:on={active} {...rest}>go</a>')
        expect(list.map((a) => a.type)).toEqual([
            'StaticAttribute',
            'EventAttribute',
            'ClassDirective',
            'SpreadAttribute',
        ])
    })

    test('directive with static value throws', () => {
        expect(() => parse('<input bind:value="oops"/>')).toThrow(ParseError)
    })

    test('attribute expression preserves nested braces', () => {
        const a = at(attrs('<div data={{ a: 1, b: [2, 3] }}/>'), 0)
        expect(a).toMatchObject({ type: 'ExpressionAttribute', expression: '{ a: 1, b: [2, 3] }' })
    })
})

describe('if block', () => {
    test('simple if', () => {
        const block = only<IfBlock>('{#if ok}yes{/if}')
        expect(block.type).toBe('IfBlock')
        expect(block.branches.length).toBe(1)
        expect(at(block.branches, 0).condition).toBe('ok')
    })

    test('if / else', () => {
        const block = only<IfBlock>('{#if ok}yes{:else}no{/if}')
        expect(block.branches.length).toBe(2)
        expect(at(block.branches, 1).condition).toBe(null)
    })

    test('if / else if / else', () => {
        const block = only<IfBlock>('{#if a}1{:else if b}2{:else}3{/if}')
        expect(block.branches.map((b) => b.condition)).toEqual(['a', 'b', null])
    })

    test('unclosed if throws', () => {
        expect(() => parse('{#if ok}yes')).toThrow(ParseError)
    })

    test('condition preserves nested braces', () => {
        const block = only<IfBlock>('{#if items[{k:1}.k]}x{/if}')
        expect(at(block.branches, 0).condition).toBe('items[{k:1}.k]')
    })
})

describe('for block', () => {
    test('basic for', () => {
        const block = only<ForBlock>('{#for item of items}{item}{/for}')
        expect(block.type).toBe('ForBlock')
        expect(block.await).toBe(false)
        expect(block.item).toBe('item')
        expect(block.index).toBe(null)
        expect(block.iterable).toBe('items')
        expect(block.key).toBe(null)
    })

    test('for with index', () => {
        const block = only<ForBlock>('{#for item, i of items}x{/for}')
        expect(block.item).toBe('item')
        expect(block.index).toBe('i')
    })

    test('for with key', () => {
        const block = only<ForBlock>('{#for item of items by item.id}x{/for}')
        expect(block.iterable).toBe('items')
        expect(block.key).toBe('item.id')
    })

    test('for with index and key', () => {
        const block = only<ForBlock>('{#for item, i of items by item.id}x{/for}')
        expect(block.index).toBe('i')
        expect(block.key).toBe('item.id')
    })

    test('destructuring item binding does not split at inner comma', () => {
        const block = only<ForBlock>('{#for { id, name } of rows}x{/for}')
        expect(block.item).toBe('{ id, name }')
        expect(block.index).toBe(null)
    })

    test('destructuring with index', () => {
        const block = only<ForBlock>('{#for { id }, i of rows}x{/for}')
        expect(block.item).toBe('{ id }')
        expect(block.index).toBe('i')
    })

    test('for await with catch', () => {
        const block = only<ForBlock>('{#for await chunk of stream}{chunk}{:catch e}{e}{/for}')
        expect(block.await).toBe(true)
        expect(block.item).toBe('chunk')
        expect(block.iterable).toBe('stream')
        expect(block.catch).not.toBe(null)
        expect(present(block.catch, 'catch').param).toBe('e')
    })

    test('for missing of throws', () => {
        expect(() => parse('{#for item items}x{/for}')).toThrow(ParseError)
    })

    test('unclosed for throws', () => {
        expect(() => parse('{#for x of xs}body')).toThrow(ParseError)
    })
})

describe('await block', () => {
    test('await with then and catch and finally', () => {
        const block = only<AwaitBlock>(
            '{#await p}loading{:then v}{v}{:catch e}{e}{:finally}done{/await}',
        )
        expect(block.type).toBe('AwaitBlock')
        expect(block.expression).toBe('p')
        expect(block.pending.some((n) => n.type === 'Text')).toBe(true)
        expect(present(block.then, 'then').param).toBe('v')
        expect(present(block.catch, 'catch').param).toBe('e')
        expect(block.finally).not.toBe(null)
    })

    test('await with then only', () => {
        const block = only<AwaitBlock>('{#await load()}{:then value}{value}{/await}')
        expect(present(block.then, 'then').param).toBe('value')
        expect(block.catch).toBe(null)
        expect(block.finally).toBe(null)
    })

    test('inline `then` shorthand — body is the then branch, no pending', () => {
        const block = only<AwaitBlock>('{#await load() then value}{value.name}{/await}')
        expect(block.expression).toBe('load()')
        expect(block.pending.length).toBe(0)
        const then = present(block.then, 'then')
        expect(then.param).toBe('value')
        expect(then.children.some((n) => n.type === 'Interpolation')).toBe(true)
        expect(block.catch).toBe(null)
    })

    test('inline `catch` shorthand — body is the catch branch, no then/pending', () => {
        const block = only<AwaitBlock>('{#await load() catch err}{err.message}{/await}')
        expect(block.expression).toBe('load()')
        expect(block.pending.length).toBe(0)
        expect(block.then).toBe(null)
        expect(present(block.catch, 'catch').param).toBe('err')
    })

    test('inline `then` may still carry a trailing `{:catch}`', () => {
        const block = only<AwaitBlock>('{#await load() then v}{v.x}{:catch e}{e.message}{/await}')
        expect(present(block.then, 'then').param).toBe('v')
        expect(present(block.catch, 'catch').param).toBe('e')
    })

    test('inline `then` is not confused by a `.then(` in the expression', () => {
        const block = only<AwaitBlock>('{#await p.then(x => x) then v}{v}{/await}')
        expect(block.expression).toBe('p.then(x => x)')
        expect(present(block.then, 'then').param).toBe('v')
    })

    test('a duplicate then branch (inline + clause) throws', () => {
        expect(() => parse('{#await load() then v}{v}{:then w}{w}{/await}')).toThrow(ParseError)
    })

    test('unclosed await throws', () => {
        expect(() => parse('{#await p}loading')).toThrow(ParseError)
    })
})

describe('switch block', () => {
    test('switch with cases and default', () => {
        const block = only<SwitchBlock>(
            "{#switch status}{:case 'a'}A{:case 'b'}B{:default}D{/switch}",
        )
        expect(block.type).toBe('SwitchBlock')
        expect(block.discriminant).toBe('status')
        expect(block.cases.map((c) => c.test)).toEqual(["'a'", "'b'", null])
    })

    test('unknown clause in switch throws', () => {
        expect(() => parse('{#switch s}{:then v}x{/switch}')).toThrow(ParseError)
    })
})

describe('try block', () => {
    test('try with catch and finally', () => {
        const block = only<TryBlock>('{#try}{risky()}{:catch err}{err}{:finally}cleanup{/try}')
        expect(block.type).toBe('TryBlock')
        expect(present(block.catch, 'catch').param).toBe('err')
        expect(block.finally).not.toBe(null)
    })

    test('try with catch only', () => {
        const block = only<TryBlock>('{#try}body{:catch e}oops{/try}')
        expect(present(block.catch, 'catch').param).toBe('e')
        expect(block.finally).toBe(null)
    })

    test('unclosed try throws', () => {
        expect(() => parse('{#try}body')).toThrow(ParseError)
    })
})

describe('snippet block', () => {
    test('snippet with params', () => {
        const block = at(parse('{#snippet row(item, i)}<td>{item}</td>{/snippet}').children, 0)
        expect(block.type).toBe('SnippetBlock')
        expect(block).toMatchObject({ name: 'row', params: 'item, i' })
    })

    test('snippet without params', () => {
        const block = at(parse('{#snippet header}<h1>hi</h1>{/snippet}').children, 0)
        expect(block).toMatchObject({ type: 'SnippetBlock', name: 'header', params: '' })
    })
})

describe('nesting', () => {
    test('if inside for inside element', () => {
        const root = parse(
            '<ul>{#for item of items}{#if item.ok}<li>{item.name}</li>{/if}{/for}</ul>',
        )
        const ul = root.children[0] as Element
        expect(ul.type).toBe('Element')
        const forBlock = ul.children[0] as ForBlock
        expect(forBlock.type).toBe('ForBlock')
        const ifBlock = forBlock.children[0] as IfBlock
        expect(ifBlock.type).toBe('IfBlock')
        const li = at(ifBlock.branches, 0).children[0] as Element
        expect(li.name).toBe('li')
    })

    test('nested if / else with elements in each branch', () => {
        const block = only<IfBlock>('{#if a}<p>a</p>{:else}<p>b</p>{/if}')
        expect((at(block.branches, 0).children[0] as Element).name).toBe('p')
        expect((at(block.branches, 1).children[0] as Element).name).toBe('p')
    })

    test('component containing a block', () => {
        const comp = only<Component>('<List>{#for x of xs}{x}{/for}</List>')
        expect(at(comp.children, 0).type).toBe('ForBlock')
    })
})

describe('script and style', () => {
    test('instance script captured raw', () => {
        const root = parse('<script>let x = state(0)\nconst y = { a: 1 }</script>')
        const script = root.instanceScript as Script
        expect(script.type).toBe('Script')
        expect(script.module).toBe(false)
        expect(script.content).toBe('let x = state(0)\nconst y = { a: 1 }')
        expect(root.moduleScript).toBe(null)
    })

    test('module script flagged', () => {
        const root = parse('<script module>export const N = 1</script>')
        const script = root.moduleScript as Script
        expect(script.module).toBe(true)
        expect(script.content).toBe('export const N = 1')
        expect(root.instanceScript).toBe(null)
    })

    test('both module and instance scripts', () => {
        const root = parse('<script module>const A = 1</script>\n<script>let b = state(2)</script>')
        expect(root.moduleScript).not.toBe(null)
        expect(root.instanceScript).not.toBe(null)
    })

    test('script body is not parsed as markup', () => {
        const root = parse("<script>if (x < y) { go() }\nconst s = '</div>'</script>")
        const script = root.instanceScript as Script
        expect(script.content).toBe("if (x < y) { go() }\nconst s = '</div>'")
    })

    test('style captured raw and scoped', () => {
        const root = parse('<style>.box { color: red }</style>')
        const style = root.style as Style
        expect(style.type).toBe('Style')
        expect(style.content).toBe('.box { color: red }')
    })

    test('script content offsets are correct', () => {
        const source = '<script>abc</script>'
        const root = parse(source)
        const script = root.instanceScript as Script
        expect(source.slice(script.contentStart, script.contentEnd)).toBe('abc')
    })

    test('nested style inside a branch is not the root style', () => {
        const root = parse('{#if x}<style>.a{color:blue}</style>{/if}')
        expect(root.style).toBe(null)
        const block = root.children[0] as IfBlock
        expect(at(block.branches, 0).children.some((n) => n.type === 'Style')).toBe(true)
    })

    test('unclosed script throws', () => {
        expect(() => parse('<script>let x = 1')).toThrow(ParseError)
    })
})

describe('positions', () => {
    test('interpolation span covers the braces', () => {
        const node = only<Interpolation>('{value}')
        expect(node.start).toBe(0)
        expect(node.end).toBe(7)
    })

    test('element span covers open through close tag', () => {
        const source = '<div>hi</div>'
        const el = at(parse(source).children, 0)
        expect(el.start).toBe(0)
        expect(el.end).toBe(source.length)
    })

    test('block span covers full block', () => {
        const source = '{#if a}x{/if}'
        const block = at(parse(source).children, 0)
        expect(block.start).toBe(0)
        expect(block.end).toBe(source.length)
    })

    test('root span covers whole source', () => {
        const source = '<div>hi</div>'
        const root = parse(source)
        expect(root.start).toBe(0)
        expect(root.end).toBe(source.length)
    })

    test('nested node offsets index into the source', () => {
        const source = '<p>{name}</p>'
        const p = parse(source).children[0] as Element
        const interp = at(p.children, 0)
        expect(source.slice(interp.start, interp.end)).toBe('{name}')
    })
})

describe('malformed input and errors', () => {
    test('unclosed expression throws a positioned ParseError', () => {
        try {
            parse('hello {name')
            throw new Error('expected a throw')
        } catch (error) {
            expect(error).toBeInstanceOf(ParseError)
            const parseError = error as ParseError
            expect(parseError.line).toBe(1)
            expect(typeof parseError.column).toBe('number')
            expect(parseError.offset).toBeGreaterThanOrEqual(0)
        }
    })

    test('stray block close throws', () => {
        expect(() => parse('{/if}')).toThrow(ParseError)
    })

    test('stray clause throws', () => {
        expect(() => parse('{:else}x')).toThrow(ParseError)
    })

    test('unknown block throws', () => {
        expect(() => parse('{#loop x}{/loop}')).toThrow(ParseError)
    })

    test('mismatched block close throws', () => {
        expect(() => parse('{#if a}x{/for}')).toThrow(ParseError)
    })

    test('filename appears in error message', () => {
        try {
            parse('{#if a}x', { filename: 'page.abide' })
            throw new Error('expected a throw')
        } catch (error) {
            expect((error as ParseError).message).toContain('page.abide')
            expect((error as ParseError).filename).toBe('page.abide')
        }
    })

    test('error line and column reflect a later line', () => {
        try {
            parse('line one\nline two {oops')
            throw new Error('expected a throw')
        } catch (error) {
            expect((error as ParseError).line).toBe(2)
        }
    })
})

describe('full template smoke test', () => {
    test('parses a representative document', () => {
        const source = `<script module>
export const TITLE = "Users"
</script>
<script>
let query = state("")
</script>
<style>
.list { display: grid }
</style>
<section class="list">
  <h1>{TITLE}</h1>
  <input bind:value={query} oninput={onType} />
  {#await users(query)}
    <p>loading…</p>
  {:then list}
    <ul>
      {#for user, i of list by user.id}
        <li class:me={user.id === myId}>{i}: {user.name}</li>
      {/for}
    </ul>
  {:catch err}
    <p>{err.message}</p>
  {/await}
  <Avatar {...avatarProps} />
</section>`
        const root = parse(source)
        expect(root.moduleScript).not.toBe(null)
        expect(root.instanceScript).not.toBe(null)
        expect(root.style).not.toBe(null)
        const section = root.children.find(
            (n) => n.type === 'Element' && n.name === 'section',
        ) as Element
        expect(section).toBeDefined()
        expect(section.end).toBeLessThanOrEqual(source.length)
    })
})
