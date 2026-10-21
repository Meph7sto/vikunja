import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {createDefaultViews} from '../project/prepareProjects'
import {setupApiUrl} from '../../support/authenticateUser'

test('registration creates no task inbox and keeps the notification inbox available', async ({page, apiContext}) => {
	const user = {
		username: 'no-default-inbox',
		email: 'no-default-inbox@example.com',
		password: '12345678',
	}
	const registration = await apiContext.post('/api/v2/register', {data: user})
	expect(registration.ok()).toBe(true)
	const signedIn = await apiContext.post('/api/v2/login', {
		data: {
			username: user.username,
			password: user.password,
		},
	})
	expect(signedIn.ok()).toBe(true)
	const {token} = await signedIn.json()
	await setupApiUrl(page)
	await page.addInitScript(token => localStorage.setItem('token', token), token)
	await page.goto('/')
	await expect(page.locator('.task-add-project')).toBeVisible()
	await expect(page.getByRole('link', {name: 'Create project', exact: true})).toHaveAttribute('href', '/projects/new')
	await expect(page.locator('.menu-container a[href="/inbox"]')).toBeVisible()
	await page.reload()
	const response = await apiContext.get('/api/v2/projects', {
		headers: {Authorization: `Bearer ${token}`},
	})
	expect(response.ok()).toBe(true)
	const body = await response.json()
	expect(body.items.filter((project: {id: number}) => project.id > 0)).toEqual([])
	await page.locator('.menu-container a[href="/inbox"]').click()
	await expect(page.getByRole('heading', {name: 'Inbox', exact: true})).toBeVisible()
})

test('home quick add selects an existing project without a default inbox', async ({
	authenticatedPage: page,
	apiContext,
	userToken,
}, testInfo) => {
	await ProjectFactory.create(2, {title: (i: number) => i === 1 ? 'Work' : 'Personal'})
	await createDefaultViews(1)
	await createDefaultViews(2, 5)
	await page.goto('/')
	const title = 'A task in my chosen project'
	const input = page.locator('.task-add textarea')
	await input.fill(title)
	await page.locator('.task-add .add-task-button').click()
	await expect(page.locator('.task-add .help.is-danger')).toBeVisible()
	await expect(input).toHaveValue(title)
	const picker = page.locator('.task-add-project')
	await picker.getByRole('combobox').pressSequentially('Work')
	await picker.getByRole('option').filter({hasText: 'Work'}).click()
	const created = page.waitForResponse(response => response.request().method() === 'POST'
		&& response.url().includes('/tasks/bulk'))
	await page.locator('.task-add .add-task-button').click()
	const result = await (await created).json()
	const task = result.tasks[0]
	expect(task.project_id).toBe(1)
	await page.reload()
	const headers = {Authorization: `Bearer ${userToken}`}
	const stored = await apiContext.get(`/api/v2/tasks/${task.id}`, {headers})
	expect(await stored.json()).toMatchObject({
		title,
		project_id: 1,
	})
	const projects = await apiContext.get('/api/v2/projects', {headers})
	expect((await projects.json()).items.filter((project: {id: number}) => project.id > 0)).toHaveLength(2)
	await expect(page.locator('.vikunja-loading')).toHaveCount(0)
	await page.screenshot({path: testInfo.outputPath('home-project-picker-desktop.png'), fullPage: true})
	await page.setViewportSize({
		width: 375,
		height: 812,
	})
	await expect(page.locator('.menu-container')).not.toHaveClass(/is-active/)
	await expect(page.locator('#main-content')).toHaveCSS('margin-inline-start', '0px')
	await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
	await page.screenshot({path: testInfo.outputPath('home-project-picker-mobile.png'), fullPage: true})
})

for (const [name, path] of [['home', '/'], ['favorites', '/projects/-1/-1']]) {
	test(`quick actions on ${name} asks for a project without discarding the task title`, async ({
		authenticatedPage: page,
		apiContext,
		userToken,
	}) => {
		await ProjectFactory.create(1, {title: 'Work'})
		await createDefaultViews(1)
		if (name === 'favorites') {
			const [task] = await TaskFactory.create(1, {project_id: 1, title: 'Favorite task'})
			const favorite = await apiContext.put(`/api/v2/tasks/${task.id}`, {
				headers: {Authorization: `Bearer ${userToken}`},
				data: {title: task.title, is_favorite: true},
			})
			expect(favorite.ok()).toBe(true)
		}
		await page.goto(path)
		await expect(page.locator('.vikunja-loading')).toHaveCount(0)
		if (name === 'favorites') {
			await expect(page.locator('.tasks .task').filter({hasText: 'Favorite task'})).toBeVisible()
		}
		await page.getByRole('button', {name: 'Open the search/quick action bar'}).click()
		await page.locator('.quick-actions .result-item-button').filter({hasText: 'New task'}).click()
		const input = page.locator('.quick-actions .action-input input')
		const title = 'A task from quick actions'
		await input.fill(title)
		await input.press('Enter')
		await expect(input).toBeVisible()
		await expect(input).toHaveValue(title)
		const picker = page.locator('.quick-actions-project')
		await picker.getByRole('combobox').pressSequentially('Work')
		await picker.getByRole('option').filter({hasText: 'Work'}).click()
		await input.press('Enter')
		await expect(page).toHaveURL(/\/tasks\/\d+$/)
		await page.reload()
		const taskId = new URL(page.url()).pathname.split('/').pop()
		const stored = await apiContext.get(`/api/v2/tasks/${taskId}`, {
			headers: {Authorization: `Bearer ${userToken}`},
		})
		expect(await stored.json()).toMatchObject({
			title,
			project_id: 1,
		})
	})
}
