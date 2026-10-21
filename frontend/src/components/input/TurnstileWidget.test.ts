import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {flushPromises, mount} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'
import TurnstileWidget from './TurnstileWidget.vue'
import type {TurnstileAPI, TurnstileOptions} from '@/helpers/turnstile'
import en from '@/i18n/lang/en.json'

const loader = vi.hoisted(() => ({load: vi.fn()}))
vi.mock('@/helpers/turnstile', () => ({loadTurnstile: loader.load}))

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	messages: {en},
})
let renders: TurnstileOptions[]
let api: TurnstileAPI

function mountWidget() {
	return mount(TurnstileWidget, {
		props: {
			siteKey: 'public-key',
			action: 'register',
		},
		global: {
			plugins: [i18n],
			stubs: {XButton: true},
			directives: {tooltip: {}},
		},
	})
}

describe('TurnstileWidget', () => {
	beforeEach(() => {
		renders = []
		api = {
			ready: callback => callback(),
			render: vi.fn((_container, options) => {
				renders.push(options)
				return `widget-${renders.length}`
			}),
			reset: vi.fn(),
			remove: vi.fn(),
		}
		window.turnstile = api
		loader.load.mockResolvedValue(api)
	})
	afterEach(() => {
		vi.restoreAllMocks()
		Reflect.deleteProperty(window, 'turnstile')
		window.API_URL = ''
	})

	it('uses a fixed size when the container has no width yet and allows automatic retries', async () => {
		const wrapper = mountWidget()
		await flushPromises()
		expect(renders[0].size).toBe('normal')
		expect(renders[0].retry).toBe('auto')
		wrapper.unmount()
	})

	it('keeps transient errors recoverable and clears any previous token', async () => {
		const wrapper = mountWidget()
		await flushPromises()
		renders[0].callback('old-token')
		renders[0]['error-callback']()
		await flushPromises()
		expect(wrapper.emitted('update:modelValue')?.slice(-1)).toEqual([['']])
		expect(wrapper.find('[role="alert"]').exists()).toBe(false)
		expect(wrapper.find('.challenge').attributes('aria-busy')).toBe('true')
		renders[0].callback('retried-token')
		await flushPromises()
		expect(wrapper.emitted('update:modelValue')?.slice(-1)).toEqual([['retried-token']])
		expect(wrapper.find('.challenge').attributes('aria-busy')).toBe('false')
		renders[0]['error-callback']()
		await flushPromises()
		expect(wrapper.find('[role="alert"]').exists()).toBe(false)
		wrapper.unmount()
	})

	it('offers a manual retry after repeated errors and rearms the initial retry', async () => {
		const wrapper = mountWidget()
		await flushPromises()
		renders[0]['error-callback']()
		renders[0]['error-callback']()
		await flushPromises()
		expect(wrapper.find('[role="alert"]').text()).toBe(i18n.global.t('user.auth.verificationUnavailable'))
		await wrapper.find('x-button-stub').trigger('click')
		expect(api.reset).toHaveBeenCalledWith('widget-1')
		renders[0]['error-callback']()
		await flushPromises()
		expect(wrapper.find('[role="alert"]').exists()).toBe(false)
		wrapper.unmount()
	})

	it('preserves a loading state when render synchronously reports its first error', async () => {
		vi.mocked(api.render).mockImplementation((_container, options) => {
			options['error-callback']()
			return 'widget-1'
		})
		const wrapper = mountWidget()
		await flushPromises()
		expect(wrapper.find('[role="alert"]').exists()).toBe(false)
		expect(wrapper.find('.challenge').attributes('aria-busy')).toBe('true')
		wrapper.unmount()
	})

	it('retains compact sizing for narrow visible containers', async () => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 250, 150))
		const wrapper = mountWidget()
		await flushPromises()
		expect(renders).toHaveLength(1)
		expect(renders[0].size).toBe('compact')
		wrapper.unmount()
	})

	it('sets the fixed action and clears the token on expiry and error', async () => {
		const wrapper = mountWidget()
		await flushPromises()
		expect(renders[0].action).toBe('register')
		expect(renders[0]['response-field']).toBe(false)
		renders[0].callback('solved-token')
		expect(wrapper.emitted('update:modelValue')?.slice(-1)).toEqual([['solved-token']])
		renders[0]['expired-callback']()
		expect(wrapper.emitted('update:modelValue')?.slice(-1)).toEqual([['']])
		renders[0].callback('another-token')
		renders[0]['error-callback']()
		expect(wrapper.emitted('update:modelValue')?.slice(-1)).toEqual([['']])
		wrapper.unmount()
	})

	it('ignores callbacks after unmount and removes the widget', async () => {
		const wrapper = mountWidget()
		await flushPromises()
		renders[0].callback('before-unmount')
		wrapper.unmount()
		const count = wrapper.emitted('update:modelValue')?.length
		renders[0].callback('too-late')
		expect(wrapper.emitted('update:modelValue')).toHaveLength(count!)
		expect(api.remove).toHaveBeenCalledWith('widget-1')
	})

	it('ignores an old widget after the site key or API instance changes', async () => {
		const wrapper = mountWidget()
		await flushPromises()
		await wrapper.setProps({siteKey: 'new-public-key'})
		await flushPromises()
		renders[1].callback('new-key-token')
		renders[0].callback('old-key-token')
		expect(wrapper.emitted('update:modelValue')?.slice(-1)).toEqual([['new-key-token']])
		window.API_URL = 'https://other.example.com'
		renders[1].callback('old-instance-token')
		expect(wrapper.emitted('update:modelValue')?.flat()).not.toContain('old-instance-token')
		wrapper.unmount()
	})

	it('does not render when a pending script finishes after unmount', async () => {
		let resolve!: (value: TurnstileAPI) => void
		loader.load.mockReturnValue(new Promise<TurnstileAPI>(done => { resolve = done }))
		const wrapper = mountWidget()
		wrapper.unmount()
		resolve(api)
		await flushPromises()
		expect(api.render).not.toHaveBeenCalled()
	})
})
