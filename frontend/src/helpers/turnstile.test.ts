import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {TurnstileAPI} from './turnstile'

const script = () => document.querySelector<HTMLScriptElement>('#vikunja-turnstile-script')!
const api = (): TurnstileAPI => ({
	ready: callback => callback(),
	render: vi.fn(() => 'widget'),
	reset: vi.fn(),
	remove: vi.fn(),
})

describe('Turnstile script loader', () => {
	beforeEach(() => {
		vi.resetModules()
		Reflect.deleteProperty(window, 'turnstile')
		script()?.remove()
		const append = document.head.appendChild.bind(document.head)
		vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
			// happy-dom otherwise emits a synchronous error for every external script.
			if (node instanceof HTMLScriptElement) node.type = 'application/json'
			return append(node)
		})
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		Reflect.deleteProperty(window, 'turnstile')
		script()?.remove()
	})

	it('shares a single explicit-render script and Promise across concurrent widgets', async () => {
		const {loadTurnstile} = await import('./turnstile')
		const first = loadTurnstile()
		const second = loadTurnstile()
		expect(first).toBe(second)
		expect(document.querySelectorAll('#vikunja-turnstile-script')).toHaveLength(1)
		expect(script().src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
		window.turnstile = api()
		script().dispatchEvent(new Event('load'))
		await expect(first).resolves.toBe(window.turnstile)
		await expect(second).resolves.toBe(window.turnstile)
	})

	it('waits for the API to appear after the script load event', async () => {
		vi.useFakeTimers()
		const {loadTurnstile} = await import('./turnstile')
		const promise = loadTurnstile()
		const settled = vi.fn()
		void promise.then(settled, settled)
		script().dispatchEvent(new Event('load'))
		await vi.advanceTimersByTimeAsync(500)
		expect(settled).not.toHaveBeenCalled()
		expect(script()).not.toBeNull()
		window.turnstile = api()
		await vi.advanceTimersByTimeAsync(100)
		await expect(promise).resolves.toBe(window.turnstile)
		expect(vi.getTimerCount()).toBe(0)
	})

	it('waits for render on an existing partially initialized API without calling ready', async () => {
		vi.useFakeTimers()
		const initializing = api()
		initializing.ready = vi.fn(() => { throw new Error('Not ready yet') })
		const render = initializing.render
		Reflect.deleteProperty(initializing, 'render')
		window.turnstile = initializing
		const {loadTurnstile} = await import('./turnstile')
		const promise = loadTurnstile()
		const settled = vi.fn()
		void promise.then(settled, settled)
		await vi.advanceTimersByTimeAsync(500)
		expect(settled).not.toHaveBeenCalled()
		initializing.render = render
		await vi.advanceTimersByTimeAsync(100)
		await expect(promise).resolves.toBe(initializing)
		expect(initializing.ready).not.toHaveBeenCalled()
		expect(script()).toBeNull()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('accepts a renderable API even when ready would throw', async () => {
		const {loadTurnstile} = await import('./turnstile')
		const promise = loadTurnstile()
		window.turnstile = api()
		window.turnstile.ready = vi.fn(() => { throw new Error('Not ready yet') })
		script().dispatchEvent(new Event('load'))
		await expect(promise).resolves.toBe(window.turnstile)
		expect(window.turnstile.ready).not.toHaveBeenCalled()
		expect(script()).not.toBeNull()
	})

	it('removes a failed script so an explicit retry can load it again', async () => {
		const {loadTurnstile} = await import('./turnstile')
		const first = loadTurnstile()
		const rejected = expect(first).rejects.toThrow()
		script().dispatchEvent(new Event('error'))
		await rejected
		expect(script()).toBeNull()
		const second = loadTurnstile()
		window.turnstile = api()
		script().dispatchEvent(new Event('load'))
		await expect(second).resolves.toBe(window.turnstile)
	})

	it('times out rather than leaving forms permanently loading', async () => {
		vi.useFakeTimers()
		const {loadTurnstile} = await import('./turnstile')
		const rejected = expect(loadTurnstile()).rejects.toThrow()
		await vi.advanceTimersByTimeAsync(20000)
		await rejected
		expect(script()).toBeNull()
	})

	it('keeps the original timeout while polling after load and permits a fresh retry', async () => {
		vi.useFakeTimers()
		const {loadTurnstile} = await import('./turnstile')
		const promise = loadTurnstile()
		const rejected = expect(promise).rejects.toThrow('Could not load human verification')
		await vi.advanceTimersByTimeAsync(14000)
		script().dispatchEvent(new Event('load'))
		await vi.advanceTimersByTimeAsync(1000)
		await rejected
		expect(script()).toBeNull()
		expect(vi.getTimerCount()).toBe(0)
		const retry = loadTurnstile()
		expect(retry).not.toBe(promise)
		window.turnstile = api()
		script().dispatchEvent(new Event('load'))
		await expect(retry).resolves.toBe(window.turnstile)
		expect(vi.getTimerCount()).toBe(0)
	})

	it('stops polling when the script emits an error', async () => {
		vi.useFakeTimers()
		const {loadTurnstile} = await import('./turnstile')
		const rejected = expect(loadTurnstile()).rejects.toThrow()
		script().dispatchEvent(new Event('load'))
		script()?.dispatchEvent(new Event('error'))
		await rejected
		expect(script()).toBeNull()
		expect(vi.getTimerCount()).toBe(0)
	})
})
