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
})
