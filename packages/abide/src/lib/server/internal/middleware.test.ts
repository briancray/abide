import { describe, expect, test } from 'bun:test'
import { compose, type Middleware } from './middleware.ts'

describe('compose', () => {
    test('empty middleware list invokes just the handler', async () => {
        const composed = compose([], () => new Response('handler'))
        const response = await composed()
        expect(await response.text()).toBe('handler')
    })

    test('outer runs before inner on the way in, after on the way out', async () => {
        const order: string[] = []
        const outer: Middleware = async (next) => {
            order.push('outer:before')
            const response = await next()
            order.push('outer:after')
            return response
        }
        const inner: Middleware = async (next) => {
            order.push('inner:before')
            const response = await next()
            order.push('inner:after')
            return response
        }
        const composed = compose([outer, inner], () => {
            order.push('handler')
            return new Response('ok')
        })
        const response = await composed()
        expect(await response.text()).toBe('ok')
        expect(order).toEqual([
            'outer:before',
            'inner:before',
            'handler',
            'inner:after',
            'outer:after',
        ])
    })

    test('short-circuit: a middleware returning without next() skips handler and inner layers', async () => {
        let handlerRan = false
        let innerRan = false
        const gate: Middleware = () => new Response('blocked', { status: 401 })
        const inner: Middleware = (next) => {
            innerRan = true
            return next()
        }
        const composed = compose([gate, inner], () => {
            handlerRan = true
            return new Response('ok')
        })
        const response = await composed()
        expect(response.status).toBe(401)
        expect(await response.text()).toBe('blocked')
        expect(handlerRan).toBe(false)
        expect(innerRan).toBe(false)
    })

    test('a middleware can post-process the returned Response', async () => {
        const tag: Middleware = async (next) => {
            const response = await next()
            const replaced = new Response(await response.text(), response)
            replaced.headers.set('x-tag', '1')
            return replaced
        }
        const composed = compose([tag], () => new Response('body'))
        const response = await composed()
        expect(await response.text()).toBe('body')
        expect(response.headers.get('x-tag')).toBe('1')
    })

    test('passthrough chain returns the handler result unchanged', async () => {
        const passthrough: Middleware = (next) => next()
        const handlerResponse = new Response('through')
        const composed = compose([passthrough, passthrough, passthrough], () => handlerResponse)
        const response = await composed()
        expect(response).toBe(handlerResponse)
        expect(await response.text()).toBe('through')
    })

    test('supports async middleware and async handler', async () => {
        const delay: Middleware = async (next) => {
            await Promise.resolve()
            return next()
        }
        const composed = compose([delay], async () => {
            await Promise.resolve()
            return new Response('async')
        })
        const response = await composed()
        expect(await response.text()).toBe('async')
    })

    test('later middleware short-circuit still runs earlier post-processing', async () => {
        const order: string[] = []
        const outer: Middleware = async (next) => {
            order.push('outer:before')
            const response = await next()
            order.push('outer:after')
            return response
        }
        const gate: Middleware = () => {
            order.push('gate:block')
            return new Response('nope', { status: 403 })
        }
        let handlerRan = false
        const composed = compose([outer, gate], () => {
            handlerRan = true
            return new Response('ok')
        })
        const response = await composed()
        expect(response.status).toBe(403)
        expect(handlerRan).toBe(false)
        expect(order).toEqual(['outer:before', 'gate:block', 'outer:after'])
    })
})
