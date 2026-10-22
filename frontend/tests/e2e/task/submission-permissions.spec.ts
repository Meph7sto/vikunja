import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {UserFactory} from '../../factories/user'
import {UserProjectFactory} from '../../factories/users_project'
import {BucketFactory} from '../../factories/bucket'
import {login} from '../../support/authenticateUser'
import {createDefaultViews} from '../project/prepareProjects'

test('writers submit files and comments without managing tasks or other uploads', async ({
	authenticatedPage: page,
	apiContext,
	currentUser,
	userToken,
}) => {
	const [owner] = await UserFactory.create(1, {id: 2}, false)
	const [project] = await ProjectFactory.create(1, {
		title: 'Submission project',
		owner_id: owner.id,
	})
	const views = await createDefaultViews(project.id)
	await BucketFactory.create(1, {project_view_id: views[3].id})
	await UserProjectFactory.create(1, {
		project_id: project.id,
		user_id: currentUser.id,
		permission: 1,
	})
	const [task] = await TaskFactory.create(1, {
		project_id: project.id,
		title: 'Submit the report',
		created_by_id: owner.id,
	})
	const ownerAuth = await login(null, apiContext, owner)
	const ownerUpload = await apiContext.post(`/api/v2/tasks/${task.id}/attachments`, {
		headers: {Authorization: `Bearer ${ownerAuth.token}`},
		multipart: {
			files: {
				name: 'requirements.txt',
				mimeType: 'text/plain',
				buffer: Buffer.from('Administrator requirements'),
			},
		},
	})
	expect(ownerUpload.ok()).toBeTruthy()
	const ownerAttachment = (await ownerUpload.json()).success[0]
	const headers = {Authorization: `Bearer ${userToken}`}

	await page.goto(`/tasks/${task.id}`)
	await expect(page.locator('.task-view h1')).toContainText(task.title)
	await expect(page.getByRole('button', {name: 'Mark task done', exact: true})).toHaveCount(0)
	await expect(page.locator('.heading [contenteditable="true"]')).toHaveCount(0)
	await expect(page.locator('.attachment', {hasText: 'requirements.txt'})
		.getByRole('button', {name: 'Delete this attachment'})).toHaveCount(0)
	await page.locator('#files').setInputFiles({
		name: 'report.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('Submitted report'),
	})
	await expect(page.locator('.attachment', {hasText: 'report.txt'})).toBeVisible()
	await page.locator('.comments .tiptap[contenteditable="true"]').fill('Materials submitted')
	await page.locator('.comments').getByRole('button', {name: 'Comment', exact: true}).click()
	await page.reload()
	await expect(page.locator('.comments')).toContainText('Materials submitted')
	const comment = page.locator('.comments .comment[id^="comment-"]')
	await comment.getByRole('button', {name: 'Edit', exact: true}).click()
	await comment.locator('.tiptap[contenteditable="true"]').fill('Materials updated')
	await comment.getByRole('button', {name: 'Save', exact: true}).click()
	await page.reload()
	await expect(comment).toContainText('Materials updated')
	await page.screenshot({
		path: test.info().outputPath('writer-desktop.png'),
		fullPage: true,
	})
	await page.setViewportSize({
		width: 390,
		height: 844,
	})
	await page.reload()
	await expect(page.locator('.app-content')).not.toHaveClass(/is-menu-enabled/)
	await expect(page.locator('#files')).toHaveCount(1)
	await expect(comment).toContainText('Materials updated')
	await page.screenshot({
		path: test.info().outputPath('writer-mobile.png'),
		fullPage: true,
		animations: 'disabled',
	})
	await page.setViewportSize({
		width: 1280,
		height: 720,
	})
	const ownAttachment = page.locator('.attachment', {hasText: 'report.txt'})
	await ownAttachment.getByRole('button', {name: 'Delete this attachment'}).click()
	await page.getByRole('dialog').getByRole('button', {name: 'Do it!'}).click()
	await expect(ownAttachment).toHaveCount(0)
	await page.reload()
	await expect(ownAttachment).toHaveCount(0)
	await expect(page.locator('.attachment', {hasText: 'requirements.txt'})).toBeVisible()

	const attachments = await apiContext.get(`/api/v2/tasks/${task.id}/attachments`, {headers})
	expect((await attachments.json()).items).toEqual([
		expect.objectContaining({id: ownerAttachment.id}),
	])
	const forbiddenDelete = await apiContext.delete(`/api/v2/tasks/${task.id}/attachments/${ownerAttachment.id}`, {headers})
	expect(forbiddenDelete.status()).toBe(403)
	for (const data of [{done: true}, {percent_done: 1}, {title: 'Changed'}, {priority: 5}]) {
		const response = await apiContext.patch(`/api/v2/tasks/${task.id}`, {
			headers,
			data,
		})
		expect(response.status()).toBe(403)
	}
	const legacyUpdate = await apiContext.post(`tasks/${task.id}`, {
		headers,
		data: {title: task.title, done: true},
	})
	expect(legacyUpdate.status()).toBe(403)
	const storedTask = await apiContext.get(`tasks/${task.id}`, {headers})
	expect(await storedTask.json()).toEqual(expect.objectContaining({
		title: task.title,
		done: false,
	}))

	await page.goto(`/projects/${project.id}/${views[0].id}`)
	await expect(page.locator('.single-task').first()).toBeVisible()
	await expect(page.locator('.single-task input[type="checkbox"]').first()).toBeDisabled()
	await expect(page.locator('.task-add')).toHaveCount(0)

	await UserProjectFactory.create(1, {
		project_id: project.id,
		user_id: currentUser.id,
		permission: 0,
	})
	await page.goto(`/tasks/${task.id}`)
	await page.reload()
	await expect(page.locator('.attachment', {hasText: 'requirements.txt'})).toBeVisible()
	await expect(page.locator('#files')).toHaveCount(0)
	await expect(page.locator('.comments .tiptap[contenteditable="true"]')).toHaveCount(0)
	const forbiddenComment = await apiContext.post(`/api/v2/tasks/${task.id}/comments`, {
		headers,
		data: {comment: 'Not allowed'},
	})
	expect(forbiddenComment.status()).toBe(403)
})
