import {QueryClient, VueQueryPlugin} from '@tanstack/vue-query'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'
import {createPinia, setActivePinia} from 'pinia'
import RequestPasswordReset from './RequestPasswordReset.vue'
import FormField from '@/components/input/FormField.vue'
import en from '@/i18n/lang/en.json'
import {useConfigStore} from '@/stores/config'
import type {TurnstileOptions} from '@/helpers/turnstile'

const {requestResetPassword} = vi.hoisted(() => ({requestResetPassword: vi.fn()}))

vi.mock('@/client/generated', () => ({authPasswordToken: requestResetPassword}))
vi.mock('@/helpers/turnstile', () => ({loadTurnstile: () => Promise.resolve(window.turnstile)}))

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

describe('RequestPasswordReset', () => {
	beforeEach(() => {
		requestResetPassword.mockReset()
	})
	afterEach(() => {
		Reflect.deleteProperty(window, 'turnstile')
	})
	it('shows the error when the request fails without a response', async () => {
		requestResetPassword.mockRejectedValue(new TypeError('Failed to fetch'))
		const errors: unknown[] = []

		const wrapper = mount(RequestPasswordReset, {
			global: {
				plugins: [i18n, createPinia(), [VueQueryPlugin, {queryClient: new QueryClient()}]],
				directives: {focus: {}},
				stubs: {XButton: true, FormField: true},
				config: {
					errorHandler(err) {
						errors.push(err)
					},
				},
			},
		})

		wrapper.findComponent(FormField).vm.$emit('update:modelValue', 'user@example.com')
		await wrapper.find('form').trigger('submit')
		await flushPromises()

		expect(errors).toEqual([])
		expect(requestResetPassword).toHaveBeenCalledWith({body: {email: 'user@example.com'}})
		expect(wrapper.text()).toContain('Failed to fetch')
		wrapper.unmount()
	})

	it('guards repeated submissions, retains the email on failure and requires a fresh challenge', async () => {
		const pinia = createPinia()
		setActivePinia(pinia)
		useConfigStore().setConfig({
			version: 'v2',
			turnstile: {
				enabled: true,
				site_key: 'public-key',
			},
		})
		let options!: TurnstileOptions
		const reset = vi.fn()
		window.turnstile = {
			ready: callback => callback(),
			render: (_container, value) => {
				options = value
				return 'reset-widget'
			},
			reset,
			remove: vi.fn(),
		}
		const client = new QueryClient()
		const wrapper = mount(RequestPasswordReset, {
			global: {
				plugins: [i18n, pinia, [VueQueryPlugin, {queryClient: client}]],
				directives: {
					focus: {},
					tooltip: {},
				},
				stubs: {
					XButton: true,
					FormField: true,
				},
			},
		})
		await flushPromises()
		wrapper.findComponent(FormField).vm.$emit('update:modelValue', 'user@example.com')
		await wrapper.find('form').trigger('submit')
		expect(requestResetPassword).not.toHaveBeenCalled()
		expect(options.action).toBe('password_reset')
		let reject!: (reason: Error) => void
		requestResetPassword.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
		options.callback('first-token')
		await wrapper.find('form').trigger('submit')
		await wrapper.find('form').trigger('submit')
		expect(requestResetPassword).toHaveBeenCalledExactlyOnceWith({
			body: {
				email: 'user@example.com',
				turnstile_token: 'first-token',
			},
		})
		reject(new TypeError('Failed to fetch'))
		await flushPromises()
		expect(reset).toHaveBeenCalledWith('reset-widget')
		expect(wrapper.findComponent(FormField).props('modelValue')).toBe('user@example.com')
		await wrapper.find('form').trigger('submit')
		expect(requestResetPassword).toHaveBeenCalledOnce()
		options.callback('second-token')
		requestResetPassword.mockResolvedValue({data: {message: 'Token was sent.'}})
		await wrapper.find('form').trigger('submit')
		await flushPromises()
		expect(wrapper.text()).toContain('Check your inbox')
		await expect.poll(() => client.getMutationCache().getAll().length).toBe(0)
		wrapper.unmount()
		client.clear()
	})
})
