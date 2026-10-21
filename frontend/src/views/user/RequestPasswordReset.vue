<template>
	<div>
		<Message
			v-if="errorMsg"
			variant="danger"
			class="mbe-4"
		>
			{{ errorMsg }}
		</Message>
		<div
			v-if="isSuccess"
			class="has-text-centered mbe-4"
		>
			<Message variant="success">
				{{ $t('user.auth.resetPasswordSuccess') }}
			</Message>
			<XButton
				:to="{ name: 'user.login' }"
				class="mbs-4"
			>
				{{ $t('user.auth.login') }}
			</XButton>
		</div>
		<form
			v-if="!isSuccess"
			@submit.prevent="requestPasswordReset"
		>
			<FormField
				id="email"
				v-model="email"
				v-focus
				:label="$t('user.auth.email')"
				name="email"
				:placeholder="$t('user.auth.emailPlaceholder')"
				required
				type="email"
				autocomplete="email"
			/>

			<TurnstileWidget
				v-if="configStore.turnstile.enabled"
				:key="configStore.turnstileRevision"
				ref="turnstileWidget"
				v-model="turnstileToken"
				:site-key="configStore.turnstile.site_key"
				action="password_reset"
			/>

			<div class="reset-actions">
				<XButton
					type="submit"
					:loading="passwordResetMutation.isPending.value"
					:aria-disabled="!challengeReady || isSubmitting"
				>
					{{ $t('user.auth.resetPasswordAction') }}
				</XButton>
				<XButton
					:to="{ name: 'user.login' }"
					variant="secondary"
				>
					{{ $t('user.auth.login') }}
				</XButton>
			</div>
		</form>
	</div>
</template>

<script setup lang="ts">
import {ref} from 'vue'

import {useRequestPasswordResetMutation} from '@/client/queries/passwords'
import {isRequestContextAbort} from '@/client/requestContext'
import Message from '@/components/misc/Message.vue'
import {getErrorText} from '@/message'
import FormField from '@/components/input/FormField.vue'
import TurnstileWidget from '@/components/input/TurnstileWidget.vue'
import {useConfigStore} from '@/stores/config'
import {useTurnstileChallenge} from '@/composables/useTurnstileChallenge'

const passwordResetMutation = useRequestPasswordResetMutation()
const configStore = useConfigStore()
const {
	token: turnstileToken,
	widget: turnstileWidget,
	canSubmit: challengeReady,
	prepareSubmission,
} = useTurnstileChallenge()
const email = ref('')
const errorMsg = ref('')
const isSuccess = ref(false)
const isSubmitting = ref(false)

async function requestPasswordReset() {
	if (isSubmitting.value || isSuccess.value) return
	errorMsg.value = ''
	const challenge = prepareSubmission()
	if (!challenge) {
		errorMsg.value = getErrorText({code: 20001})
		return
	}
	isSubmitting.value = true
	try {
		await passwordResetMutation.mutateAsync({
			email: email.value,
			...(challenge.token ? {turnstile_token: challenge.token} : {}),
		})
		isSuccess.value = true
	} catch (e) {
		if (isRequestContextAbort(e)) return
		errorMsg.value = getErrorText(e)
	} finally {
		challenge.reset()
		isSubmitting.value = false
	}
}
</script>

<style scoped>
.reset-actions {
	display: flex;
	flex-wrap: wrap;
	gap: .5rem;
}
</style>
