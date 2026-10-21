import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {ProjectViewFactory} from '../../factories/project_view'
import {TaskFactory} from '../../factories/task'
import {NotificationFactory} from '../../factories/notification'
import {UserFactory} from '../../factories/user'
import {UserProjectFactory} from '../../factories/users_project'
import {login} from '../../support/authenticateUser'

const UNREAD = '0001-01-01T00:00:00Z'

async function seedInbox(count = 1, read = false) {
	await ProjectFactory.create(1, {title: 'Reports'})
	await ProjectViewFactory.create(1)
	await TaskFactory.create(1, {
		title: 'Prepare the weekly report',
		project_id: 1,
		done: false,
	})
	await NotificationFactory.create(count, {
		project_id: 1,
		read_at: read ? new Date().toISOString() : UNREAD,
		created: (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
		notification: JSON.stringify({
			task: {
				id: 1,
				index: 1,
				title: 'Prepare the weekly report',
			},
			project: {
				id: 1,
				title: 'Reports',
			},
		}),
	})
}

test.describe('Notification inbox', () => {
	test('has its own navigation and preserves the original task project', async ({authenticatedPage: page}) => {
		await seedInbox()
		await page.goto('/')
		const inboxLink = page.locator('.menu-container a[href="/inbox"]')
		await expect(inboxLink).toHaveText('Inbox')
		await expect(page.locator('.project-menu-title').filter({hasText: 'Reports'})).toBeVisible()
		await inboxLink.click()
		await expect(page).toHaveURL(/\/inbox$/)
		await expect(page.getByRole('heading', {name: 'Inbox', exact: true})).toBeVisible()
		await expect(page.locator('.notification-inbox .notification-row')).toHaveCount(1)
		await page.reload()
		await expect(page.locator('.notification-inbox .notification-row')).toHaveCount(1)
		await page.locator('.notifications .trigger-button').click()
		await page.getByRole('link', {name: 'Open inbox', exact: true}).click()
		await expect(page).toHaveURL(/\/inbox$/)
		await expect(page.locator('.notifications .notifications-list')).toHaveCount(0)
	})

	test('opens the original task and persists read state without completing or moving it', async ({
		authenticatedPage: page,
		apiContext,
		userToken,
	}) => {
		await seedInbox()
		await page.goto('/inbox')
		await page.locator('.notification-inbox .notification-link').click()
		await expect(page).toHaveURL(/\/tasks\/1$/)
		const headers = {Authorization: `Bearer ${userToken}`}
		await expect.poll(async () => {
			const response = await apiContext.get('/api/v2/notifications', {headers})
			const body = await response.json()
			return body.items[0].read_at
		}).not.toBe(UNREAD)
		const response = await apiContext.get('/api/v2/tasks/1', {headers})
		expect(response.ok()).toBe(true)
		expect(await response.json()).toMatchObject({
			id: 1,
			project_id: 1,
			done: false,
		})
		await page.goto('/inbox')
		await page.reload()
		await expect(page.locator('.notification-inbox .notification-row')).toHaveClass(/is-read/)
		await page.getByRole('button', {name: 'Unread', exact: true}).click()
		await expect(page.locator('.notification-inbox .notification-row')).toHaveCount(0)
		await expect(page.getByText('No unread notifications.', {exact: true})).toBeVisible()
	})

	test('finds unread messages beyond the first page and marks all pages read', async ({
		authenticatedPage: page,
		apiContext,
		userToken,
	}) => {
		await seedInbox(20, true)
		await NotificationFactory.create(3, {
			id: (i: number) => 20 + i,
			project_id: 1,
			read_at: UNREAD,
			created: '2025-12-01T00:00:00Z',
			notification: JSON.stringify({task: {
				id: 1,
				title: 'Older unread task',
			}}),
		}, false)
		await page.goto('/inbox')
		await expect(page.locator('.notification-inbox .notification-row')).toHaveCount(20)
		await page.getByRole('button', {name: 'Unread', exact: true}).click()
		await expect(page.locator('.notification-inbox .notification-row')).toHaveCount(3)
		await page.getByRole('button', {name: 'Mark all notifications as read', exact: true}).click()
		await expect(page.getByText('No unread notifications.', {exact: true})).toBeVisible()
		const response = await apiContext.get('/api/v2/notifications?per_page=50', {
			headers: {Authorization: `Bearer ${userToken}`},
		})
		const body = await response.json()
		expect(body.items).toHaveLength(23)
		expect(body.items.every((item: {read_at: string}) => item.read_at !== UNREAD)).toBe(true)
		await page.reload()
		await page.getByRole('button', {name: 'Unread', exact: true}).click()
		await expect(page.getByText('No unread notifications.', {exact: true})).toBeVisible()
	})

	test('receives task assignments live and keeps the inbox usable on mobile', async ({
		authenticatedPage: page,
		apiContext,
		currentUser,
	}, testInfo) => {
		const [sender] = await UserFactory.create(1, {id: 100}, false)
		const {token} = await login(null, apiContext, sender)
		await ProjectFactory.create(1, {
			id: 100,
			owner_id: sender.id,
			title: 'Team planning',
		})
		await ProjectViewFactory.create(1, {
			id: 100,
			project_id: 100,
		})
		await TaskFactory.create(1, {
			id: 100,
			project_id: 100,
			created_by_id: sender.id,
			title: 'Prepare the quarterly planning report and share the final recommendations with the whole team',
		})
		await UserProjectFactory.create(1, {
			project_id: 100,
			user_id: currentUser.id,
		})
		await page.goto('/inbox')
		await expect(page.getByText('You don\'t have any notifications. Have a nice day!', {exact: true})).toBeVisible()
		const assigned = await apiContext.post('/api/v2/tasks/100/assignees', {
			headers: {Authorization: `Bearer ${token}`},
			data: {user_id: currentUser.id},
		})
		expect(assigned.ok()).toBe(true)
		await expect(page.locator('.notification-inbox .notification-row')).toHaveCount(1, {timeout: 15000})
		await expect(page.locator('.notification-inbox')).toContainText('assigned you')
		await expect(page.locator('.notification-inbox')).toContainText('Prepare the quarterly planning report')
		await expect(page.locator('.vikunja-loading')).toHaveCount(0)
		await page.screenshot({path: testInfo.outputPath('inbox-desktop.png'), fullPage: true})
		await page.setViewportSize({
			width: 375,
			height: 812,
		})
		await expect(page.locator('.menu-container')).not.toHaveClass(/is-active/)
		await expect(page.locator('#main-content')).toHaveCSS('margin-inline-start', '0px')
		await page.getByRole('button', {name: 'Close banner'}).click()
		await expect(page.locator('.notification-inbox .notification-link')).toBeInViewport()
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
			.toBe(true)
		const avatar = await page.locator('.notification-inbox .avatar-wrapper').boundingBox()
		const subject = await page.locator('.notification-inbox .notification-subject').boundingBox()
		expect(avatar).not.toBeNull()
		expect(subject).not.toBeNull()
		expect(subject!.x).toBeGreaterThanOrEqual(avatar!.x + avatar!.width)
		await page.screenshot({path: testInfo.outputPath('inbox-mobile.png'), fullPage: true})
		await page.getByRole('button', {name: 'Mark as read', exact: true}).click()
		await expect(page.locator('.notification-inbox .notification-row')).toHaveClass(/is-read/)
		await page.reload()
		await expect(page.locator('.notification-inbox .notification-row')).toHaveClass(/is-read/)
	})

	test('opens project notifications using the project route', async ({authenticatedPage: page}) => {
		await seedInbox()
		await NotificationFactory.create(1, {
			name: 'project.created',
			project_id: 1,
			notification: JSON.stringify({project: {
				id: 1,
				title: 'Reports',
			}}),
		})
		await page.goto('/inbox')
		await page.locator('.notification-inbox .notification-link').click()
		await expect(page).toHaveURL(/\/projects\/1\//)
		await expect(page.locator('.project-title-wrapper')).toContainText('Reports')
	})

	test('shows a retryable loading error instead of an empty inbox', async ({authenticatedPage: page}) => {
		await seedInbox()
		let fail = true
		await page.route('**/api/v2/notifications?*', route => fail
			? route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({message: 'Unavailable'}),
			})
			: route.continue())
		await page.goto('/inbox')
		await expect(page.locator('.notification-inbox [role="alert"]')).toBeVisible({timeout: 15000})
		await expect(page.getByText('You don\'t have any notifications. Have a nice day!', {exact: true})).toHaveCount(0)
		fail = false
		await page.getByRole('button', {name: 'Retry', exact: true}).click()
		await expect(page.locator('.notification-inbox .notification-row')).toHaveCount(1)
	})
})

function isInboxRequest(url: string) {
	return new URL(url).pathname.endsWith('/api/v2/notifications')
}

test('notification read and clear state survives reload', async ({authenticatedPage: page, currentUser, apiContext, userToken}) => {
	const [project] = await ProjectFactory.create(1, {owner_id: currentUser.id})
	const [task] = await TaskFactory.create(1, {project_id: project.id, created_by_id: currentUser.id})
	await NotificationFactory.create(2, {
		notifiable_id: currentUser.id,
		project_id: project.id,
		notification: JSON.stringify({
			doer: currentUser,
			task,
		}),
	})
	await page.goto('/')
	const open = () => page.locator('.notifications .trigger-button').click()
	const rows = page.locator('.single-notification')
	await open()
	await expect(rows).toHaveCount(2)
	await rows.first().click()
	await open()
	await expect(page.locator('.single-notification .read-indicator.read')).toHaveCount(1)
	await page.reload()
	await open()
	await expect(page.locator('.single-notification .read-indicator.read')).toHaveCount(1)
	await page.getByRole('button', {name: 'Mark all notifications as read'}).click()
	await expect(page.locator('.single-notification .read-indicator.read')).toHaveCount(2)
	await page.reload()
	await open()
	await expect(page.locator('.single-notification .read-indicator.read')).toHaveCount(2)
	await page.getByRole('button', {name: 'Clear notifications', exact: true}).click()
	await expect(rows).toHaveCount(0)
	await page.reload()
	await open()
	await expect(rows).toHaveCount(0)
	const response = await apiContext.get('/api/v2/notifications', {headers: {Authorization: `Bearer ${userToken}`}})
	expect(response.ok()).toBe(true)
	const body = await response.json()
	expect(body.items).toEqual([])
	expect(body.total).toBe(0)
})

test('the inbox loads older notifications one page at a time', async ({authenticatedPage: page, currentUser}) => {
	const [project] = await ProjectFactory.create(1, {owner_id: currentUser.id})
	const [task] = await TaskFactory.create(1, {project_id: project.id, created_by_id: currentUser.id})
	await NotificationFactory.create(21, {
		notifiable_id: currentUser.id,
		project_id: project.id,
		notification: JSON.stringify({
			doer: currentUser,
			task,
		}),
	})
	const pageRequests: string[] = []
	page.on('request', request => {
		if (isInboxRequest(request.url())) pageRequests.push(new URL(request.url()).search)
	})
	await page.goto('/')
	await page.locator('.notifications .trigger-button').click()
	const rows = page.locator('.single-notification')
	const loadMore = page.getByRole('button', {name: 'Load older notifications'})
	await expect(rows).toHaveCount(20)
	await loadMore.click()
	await expect(rows).toHaveCount(21)
	await expect(loadMore).toHaveCount(0)
	expect(pageRequests).toContain('?page=1&per_page=20')
	expect(pageRequests).toContain('?page=2&per_page=20')
})

test('fetches the standalone inbox once per page load', async ({authenticatedPage: page}) => {
	const events: string[] = []
	// Delay the socket so the inbox response beats auth.success, the old refetch trigger.
	await page.routeWebSocket('**/api/v2/ws', ws => {
		const server = ws.connectToServer()
		server.onMessage(message => {
			setTimeout(() => {
				if (message.toString().includes('"auth.success"')) events.push('auth.success')
				ws.send(message)
			}, 300)
		})
	})
	page.on('request', request => {
		if (isInboxRequest(request.url())) events.push('inbox')
	})
	await page.goto('/inbox')
	await expect.poll(() => events).toEqual(['auth.success', 'inbox'])
	await page.waitForTimeout(1000)
	expect(events).toEqual(['auth.success', 'inbox'])
})

test('keeps polling the inbox when the websocket is unavailable', async ({authenticatedPage: page}) => {
	await page.routeWebSocket('**/api/v2/ws', ws => ws.close())
	let inboxRequests = 0
	page.on('request', request => {
		if (isInboxRequest(request.url())) inboxRequests++
	})
	await page.goto('/')
	await expect.poll(() => inboxRequests).toBe(1)
	await expect.poll(() => inboxRequests, {timeout: 13_000}).toBe(2) // 10s refetchInterval + slack
})
