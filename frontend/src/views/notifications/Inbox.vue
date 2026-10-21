<template>
	<section
		class="notification-inbox is-max-width-desktop"
		:aria-label="t('project.inboxTitle')"
	>
		<header class="inbox-header">
			<h1>{{ t('project.inboxTitle') }}</h1>
			<div class="inbox-actions">
				<XButton
					v-tooltip="t('notification.markAllRead')"
					variant="tertiary"
					icon="check-double"
					:aria-label="t('notification.markAllRead')"
					:aria-disabled="!hasNotifications || readAllMutation.isPending.value"
					:loading="readAllMutation.isPending.value"
					@click="markAllRead"
				/>
				<XButton
					v-tooltip="t('notification.subscribeFeed')"
					variant="tertiary"
					icon="rss"
					:to="{name: 'user.settings.feeds'}"
					:aria-label="t('notification.subscribeFeed')"
				/>
			</div>
		</header>

		<div
			class="inbox-filters"
			role="group"
			:aria-label="t('notification.title')"
		>
			<BaseButton
				:aria-pressed="!unreadOnly"
				@click="unreadOnly = false"
			>
				{{ t('notification.all') }}
			</BaseButton>
			<BaseButton
				:aria-pressed="unreadOnly"
				@click="unreadOnly = true"
			>
				{{ t('notification.unread') }}
			</BaseButton>
		</div>

		<Message
			v-if="query.isError.value"
			variant="danger"
			role="alert"
			class="inbox-error"
		>
			{{ t('notification.loadError') }}
			<XButton
				variant="tertiary"
				:loading="query.isFetching.value"
				@click="retry"
			>
				{{ t('sharing.retry') }}
			</XButton>
		</Message>

		<Loading
			v-if="query.isPending.value || lookingForUnread"
			variant="small"
			:aria-label="t('misc.loading')"
		/>
		<ul
			v-if="visibleNotifications.length > 0"
			class="inbox-list"
		>
			<li
				v-for="n in visibleNotifications"
				:key="n.id"
				class="notification-row"
				:class="{'is-read': n.read}"
			>
				<component
					:is="n.route ? RouterLink : BaseButton"
					:to="n.route ?? undefined"
					class="notification-link"
					@click="markRead(n)"
				>
					<span
						class="read-indicator"
						:aria-label="n.read ? t('notification.read') : t('notification.unread')"
					/>
					<User
						v-if="n.doer"
						class="notification-avatar"
						:user="n.doer"
						:show-username="false"
						:avatar-size="32"
					/>
					<span class="notification-body">
						<span
							v-if="n.subject"
							class="notification-subject"
						>
							{{ n.subject }}
						</span>
						<span class="notification-message">
							<span
								v-if="n.doer && !n.includesDoer"
								class="notification-doer"
							>
								{{ n.doerName }}
								{{ ' ' }}
							</span>
							{{ n.text || t('notification.title') }}
						</span>
						<time
							v-tooltip="formatDateLong(n.created)"
							:datetime="n.created"
							class="notification-time"
						>
							{{ formatDisplayDate(n.created) }}
						</time>
					</span>
				</component>
				<XButton
					v-tooltip="n.read ? t('notification.read') : t('notification.markRead')"
					class="mark-read"
					variant="tertiary"
					icon="check"
					:aria-label="n.read ? t('notification.read') : t('notification.markRead')"
					:aria-disabled="n.read || isMarkingRead(n)"
					:loading="isMarkingRead(n)"
					@click="markRead(n)"
				/>
			</li>
		</ul>
		<p
			v-else-if="!query.isPending.value && !lookingForUnread && !query.isError.value"
			class="inbox-empty"
			role="status"
		>
			<Icon icon="inbox" />
			{{ unreadOnly ? t('notification.noneUnread') : t('notification.none') }}
		</p>
		<XButton
			v-if="query.hasNextPage.value && !lookingForUnread"
			class="load-more"
			variant="tertiary"
			icon="chevron-down"
			:loading="query.isFetching.value"
			@click="loadMore"
		>
			{{ t('notification.loadMore') }}
		</XButton>
	</section>
</template>

<script setup lang="ts">
import {computed, ref, watchEffect} from 'vue'
import {useI18n} from 'vue-i18n'
import {RouterLink} from 'vue-router'
import {useNotifications, type NotificationRow} from '@/composables/useNotifications'
import {useTitle} from '@/composables/useTitle'
import {useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation} from '@/client/queries/notifications'
import {formatDateLong, formatDisplayDate} from '@/helpers/time/formatDate'
import BaseButton from '@/components/base/BaseButton.vue'
import XButton from '@/components/input/Button.vue'
import Loading from '@/components/misc/Loading.vue'
import Message from '@/components/misc/Message.vue'
import User from '@/components/misc/User.vue'

defineOptions({name: 'NotificationInbox'})

const {t} = useI18n({useScope: 'global'})
useTitle(() => t('project.inboxTitle'))

const {query, notifications} = useNotifications()
const readMutation = useMarkNotificationReadMutation()
const readAllMutation = useMarkAllNotificationsReadMutation()
const unreadOnly = ref(false)
const hasNotifications = computed(() => (query.data.value?.pages[0]?.total ?? 0) > 0)
const visibleNotifications = computed(() => unreadOnly.value
	? notifications.value.filter(n => !n.read)
	: notifications.value)
const lookingForUnread = computed(() => unreadOnly.value
	&& visibleNotifications.value.length === 0
	&& query.hasNextPage.value
	&& !query.isError.value)

// A read-only first page must not hide unread messages on older pages.
watchEffect(() => {
	if (lookingForUnread.value && !query.isFetching.value) {
		void query.fetchNextPage()
	}
})

function isMarkingRead(n: NotificationRow) {
	return readMutation.isPending.value && readMutation.variables.value === n.id
}

function markRead(n: NotificationRow) {
	if (n.read || isMarkingRead(n)) return
	readMutation.mutate(n.id)
}

function markAllRead() {
	if (!hasNotifications.value || readAllMutation.isPending.value) return
	readAllMutation.mutate()
}

function loadMore() {
	if (query.isFetching.value) return
	void query.fetchNextPage()
}

function retry() {
	if (query.isFetching.value) return
	if (query.isFetchNextPageError.value) void query.fetchNextPage()
	else void query.refetch()
}
</script>

<style scoped lang="scss">
.notification-inbox {
	margin-inline: auto;
	color: var(--text);
}

.inbox-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	margin-block-end: 1rem;

	h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
}

.inbox-actions {
	display: flex;
	flex-shrink: 0;
	gap: .25rem;

	.button {
		inline-size: 2.75rem;
		block-size: 2.75rem;
	}
}

.inbox-filters {
	display: flex;
	flex-wrap: wrap;
	gap: 1.25rem;
	border-block-end: 1px solid var(--grey-200);

	.base-button {
		min-block-size: 2.75rem;
		padding: .5rem .25rem;
		border-block-end: 2px solid transparent;
		color: var(--grey-600);
		font-size: .875rem;
		font-weight: 600;

		&[aria-pressed='true'] {
			border-color: var(--primary);
			color: var(--primary);
		}
	}
}

.inbox-list {
	margin: 0;
	padding: 0;
	list-style: none;
}

.notification-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 2.75rem;
	align-items: center;
	gap: .5rem;
	border-block-end: 1px solid var(--grey-200);

	&:hover {
		background: var(--grey-100);
	}
}

.notification-link {
	display: flex;
	align-items: flex-start;
	gap: .75rem;
	min-inline-size: 0;
	padding: 1rem .25rem;
	color: var(--text);
	text-align: start;

	&:hover {
		color: var(--text);
	}
}

.notification-avatar {
	flex-shrink: 0;
}

.read-indicator {
	flex: 0 0 .5rem;
	block-size: .5rem;
	margin-block-start: .5rem;
	border-radius: 50%;
	background: var(--primary);

	.is-read & {
		background: transparent;
	}
}

.notification-body {
	display: flex;
	flex-direction: column;
	gap: .25rem;
	min-inline-size: 0;
	overflow-wrap: anywhere;
}

.notification-subject {
	font-size: 1rem;
	font-weight: 600;
	line-height: 1.5;

	.is-read & {
		font-weight: 400;
	}
}

.notification-message {
	color: var(--grey-700);
	font-size: .875rem;
	line-height: 1.5;
}

.notification-doer {
	font-weight: 600;
}

.notification-time {
	color: var(--grey-500);
	font-size: .75rem;
	line-height: 1.5;
}

.mark-read {
	inline-size: 2.75rem;
	block-size: 2.75rem;
}

.inbox-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1rem;
	padding: 3rem 1rem;
	color: var(--grey-600);
	text-align: center;

	svg {
		font-size: 2rem;
		color: var(--grey-400);
	}
}

.inbox-error {
	margin-block-start: 1rem;
}

.load-more {
	display: flex;
	margin: 1rem auto;
}

.notification-link:focus-visible,
.inbox-filters .base-button:focus-visible {
	outline: 2px solid var(--primary);
	outline-offset: 2px;
}
</style>
