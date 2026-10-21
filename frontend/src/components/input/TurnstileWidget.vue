<template>
	<div class="turnstile-widget">
		<div
			class="challenge"
			:class="{'is-compact': compact}"
			:aria-busy="state === 'loading'"
		>
			<div ref="container" />
			<span
				v-if="state === 'loading'"
				class="loading-text"
				role="status"
			>
				{{ t('misc.loading') }}
			</span>
		</div>
		<div
			v-if="state === 'error' || state === 'expired'"
			class="verification-error"
		>
			<span role="alert">
				{{ t(state === 'expired' ? 'user.auth.verificationExpired' : 'user.auth.verificationUnavailable') }}
			</span>
			<XButton
				v-tooltip="t('sharing.retry')"
				icon="redo"
				variant="secondary"
				type="button"
				:aria-label="t('sharing.retry')"
				@click="reset"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useResizeObserver} from '@vueuse/core'
import {useI18n} from 'vue-i18n'
import {
	loadTurnstile,
	type TurnstileAction,
	type TurnstileAPI,
} from '@/helpers/turnstile'
import {captureClientRequestContext, isClientRequestContextCurrent} from '@/client/requestContext'
import XButton from '@/components/input/Button.vue'

const props = defineProps<{
	siteKey: string
	action: TurnstileAction
}>()
const token = defineModel<string>({default: ''})
const {t} = useI18n({useScope: 'global'})
const container = ref<HTMLElement | null>(null)
const compact = ref(false)
const state = ref<'loading' | 'ready' | 'verified' | 'expired' | 'error'>('loading')
let generation = 0
let mounted = false
let api: TurnstileAPI | undefined
let widgetId: string | undefined
let consecutiveErrors = 0
let context = captureClientRequestContext()

function removeWidget() {
	if (widgetId !== undefined) {
		try {
			api?.remove(widgetId)
		} catch {
			// A partially initialized or already removed iframe needs no further cleanup.
		}
		widgetId = undefined
	}
}

async function render() {
	const current = ++generation
	token.value = ''
	removeWidget()
	if (!mounted || !container.value) return
	state.value = 'loading'
	consecutiveErrors = 0
	context = captureClientRequestContext()
	const request = context
	const isCurrent = () => mounted && current === generation && isClientRequestContextCurrent(request)
	try {
		if (!props.siteKey) throw new Error('Missing Turnstile site key')
		api = await loadTurnstile()
		if (!isCurrent() || !container.value) return
		state.value = 'ready'
		widgetId = api.render(container.value, {
			sitekey: props.siteKey,
			action: props.action,
			theme: 'auto',
			size: compact.value ? 'compact' : 'normal',
			'response-field': false,
			retry: 'auto',
			'refresh-expired': 'manual',
			'refresh-timeout': 'manual',
			callback(value) {
				if (!isCurrent()) return
				consecutiveErrors = 0
				token.value = value
				state.value = 'verified'
			},
			'expired-callback'() {
				if (!isCurrent()) return
				token.value = ''
				state.value = 'expired'
			},
			'error-callback'() {
				if (isCurrent()) {
					token.value = ''
					state.value = ++consecutiveErrors > 1 ? 'error' : 'loading'
				}
				return true
			},
			'timeout-callback'() {
				if (!isCurrent()) return
				token.value = ''
				state.value = 'expired'
			},
		})
	} catch {
		if (isCurrent()) state.value = 'error'
	}
}

function reset() {
	token.value = ''
	if (!mounted || !isClientRequestContextCurrent(context)) return
	consecutiveErrors = 0
	if (widgetId !== undefined && api) {
		try {
			state.value = 'ready'
			api.reset(widgetId)
			return
		} catch {
			// Recreate a failed widget using the shared script loader.
		}
	}
	void render()
}

useResizeObserver(container, entries => {
	const width = entries[0]?.contentRect.width ?? 0
	if (width > 0) compact.value = width < 300
})
watch([() => props.siteKey, () => props.action, compact], render, {flush: 'sync'})
onMounted(() => {
	mounted = true
	const width = container.value?.getBoundingClientRect().width ?? 0
	compact.value = width > 0 && width < 300
	void render()
})
onBeforeUnmount(() => {
	mounted = false
	generation++
	token.value = ''
	removeWidget()
})
defineExpose({reset})
</script>

<style scoped lang="scss">
.turnstile-widget {
	margin-block-end: 1rem;
	max-inline-size: 100%;
}

.challenge {
	position: relative;
	min-block-size: 65px;

	&.is-compact {
		min-block-size: 150px;
	}
}

.loading-text {
	position: absolute;
	inset-block-start: 1rem;
	inset-inline-start: 0;
	color: var(--text-light);
}

.verification-error {
	display: flex;
	align-items: center;
	gap: .75rem;
	margin-block-start: .5rem;
	color: var(--danger);

	span {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	button {
		flex-shrink: 0;
	}
}
</style>
