import {computed, onScopeDispose, ref, watch} from 'vue'
import {useConfigStore} from '@/stores/config'
import {
	captureClientRequestContext,
	isClientRequestContextCurrent,
	type ClientRequestContext,
} from '@/client/requestContext'

export function useTurnstileChallenge() {
	const configStore = useConfigStore()
	const token = ref('')
	const widget = ref<{reset: () => void} | null>(null)
	let tokenContext: ClientRequestContext | null = null
	let disposed = false
	watch(token, value => {
		tokenContext = value ? captureClientRequestContext() : null
	}, {flush: 'sync'})
	watch(() => configStore.turnstileRevision, () => {
		token.value = ''
	}, {flush: 'sync'})
	onScopeDispose(() => {
		disposed = true
		token.value = ''
	})

	const canSubmit = computed(() => !configStore.turnstile.enabled || token.value !== '')
	function prepareSubmission() {
		if (disposed) return null
		if (configStore.turnstile.enabled &&
			(!token.value || !tokenContext || !isClientRequestContextCurrent(tokenContext))) {
			token.value = ''
			return null
		}
		const request = captureClientRequestContext()
		const revision = configStore.turnstileRevision
		return {
			token: configStore.turnstile.enabled ? token.value : undefined,
			reset() {
				if (disposed || revision !== configStore.turnstileRevision || !isClientRequestContextCurrent(request)) return
				token.value = ''
				widget.value?.reset()
			},
		}
	}
	return {
		token,
		widget,
		canSubmit,
		prepareSubmission,
	}
}
