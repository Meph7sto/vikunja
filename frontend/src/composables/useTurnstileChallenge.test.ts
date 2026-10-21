import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createPinia, setActivePinia} from 'pinia'
import {effectScope, type EffectScope} from 'vue'
import {useConfigStore} from '@/stores/config'
import {useTurnstileChallenge} from './useTurnstileChallenge'

describe('Turnstile submission lifecycle', () => {
	let scope: EffectScope
	beforeEach(() => {
		window.API_URL = ''
		setActivePinia(createPinia())
		useConfigStore().setConfig({
			version: 'v2',
			turnstile: {
				enabled: true,
				site_key: 'public-key',
			},
		})
		scope = effectScope()
	})
	afterEach(() => {
		scope.stop()
		window.API_URL = ''
	})

	it('requires a token and clears it after a completed request', () => {
		const challenge = scope.run(useTurnstileChallenge)!
		expect(challenge.prepareSubmission()).toBeNull()
		challenge.token.value = 'single-use'
		const reset = vi.fn()
		challenge.widget.value = {reset}
		const submission = challenge.prepareSubmission()!
		expect(submission.token).toBe('single-use')
		submission.reset()
		expect(challenge.token.value).toBe('')
		expect(reset).toHaveBeenCalledOnce()
	})

	it('rejects tokens from a previous API even while a new instance probe is pending', () => {
		const challenge = scope.run(useTurnstileChallenge)!
		challenge.token.value = 'old-instance'
		window.API_URL = 'https://other.example.com'
		expect(challenge.prepareSubmission()).toBeNull()
		expect(challenge.token.value).toBe('')
	})

	it('does not let an old request clear a new challenge with the same site key', () => {
		const challenge = scope.run(useTurnstileChallenge)!
		challenge.token.value = 'old-token'
		const submission = challenge.prepareSubmission()!
		window.API_URL = 'https://other.example.com'
		useConfigStore().setConfig({
			version: 'v2',
			turnstile: {
				enabled: true,
				site_key: 'public-key',
			},
		})
		expect(challenge.token.value).toBe('')
		challenge.token.value = 'new-token'
		const reset = vi.fn()
		challenge.widget.value = {reset}
		submission.reset()
		expect(challenge.token.value).toBe('new-token')
		expect(reset).not.toHaveBeenCalled()
	})

	it('clears tokens on disposal and needs none when disabled', () => {
		const challenge = scope.run(useTurnstileChallenge)!
		useConfigStore().setConfig({version: 'old-server'})
		expect(challenge.prepareSubmission()?.token).toBeUndefined()
		challenge.token.value = 'temporary'
		scope.stop()
		expect(challenge.token.value).toBe('')
		expect(challenge.prepareSubmission()).toBeNull()
	})
})
