import {computed} from 'vue'
import {useInfiniteQuery} from '@tanstack/vue-query'
import {notificationsQuery} from '@/client/queries/notifications'
import {
	NOTIFICATION_NAMES,
	notificationDoer,
	notificationRoute,
	notificationSubject,
	notificationText,
} from '@/helpers/notification'
import {parseDateOrNull} from '@/helpers/parseDateOrNull'
import {getDisplayName} from '@/helpers/user'
import {useAuthStore} from '@/stores/auth'
import {useWebSocket} from '@/composables/useWebSocket'

export function useNotifications(poll = false) {
	const {authenticated, isAwaitingFirstConnection} = useWebSocket()
	const authStore = useAuthStore()
	const query = useInfiniteQuery(computed(() => ({
		...notificationsQuery(),
		// Wait for the socket's subscription sweep instead of immediately fetching twice.
		enabled: !isAwaitingFirstConnection(),
		refetchInterval: poll && !authenticated.value ? 10_000 : false,
	})))
	// New arrivals shift page offsets, so adjacent pages may contain the same notification.
	const loadedNotifications = computed(() => [...new Map((query.data.value?.pages ?? [])
		.flatMap(page => page.items)
		.map(n => [n.id, n] as const)).values()])
	const notifications = computed(() => loadedNotifications.value.flatMap(n => {
		if (!n.name || !n.id) return []
		const doer = notificationDoer(n)
		return [{
			id: n.id,
			created: n.created,
			doer,
			doerName: getDisplayName(doer),
			includesDoer: n.name === NOTIFICATION_NAMES.TASK_MENTIONED,
			subject: notificationSubject(n),
			text: notificationText(n, authStore.info),
			route: notificationRoute(n),
			read: parseDateOrNull(n.read_at) !== null,
		}]
	}))

	return {
		query,
		notifications,
		unreadCount: computed(() => notifications.value.filter(n => !n.read).length),
	}
}

export type NotificationRow = ReturnType<typeof useNotifications>['notifications']['value'][number]
