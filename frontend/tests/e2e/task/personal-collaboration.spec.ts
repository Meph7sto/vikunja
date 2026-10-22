import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {UserFactory} from '../../factories/user'
import {UserProjectFactory} from '../../factories/users_project'
import {BucketFactory} from '../../factories/bucket'
import {createDefaultViews} from '../project/prepareProjects'

test('writers retain subscriptions, reactions and personal favorites without task management', async ({
	authenticatedPage: page,
	apiContext,
	currentUser,
	userToken,
}) => {
	const [owner] = await UserFactory.create(1, {id: 2}, false)
	const [project] = await ProjectFactory.create(1, {
		title: 'Shared collaboration',
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
		title: 'Personal collaboration controls',
		created_by_id: owner.id,
	})
	const headers = {Authorization: `Bearer ${userToken}`}
	const readTask = async () => {
		const response = await apiContext.get(`tasks/${task.id}`, {headers})
		expect(response.ok()).toBeTruthy()
		return response.json()
	}
	const readProject = async () => {
		const response = await apiContext.get(`projects/${project.id}`, {headers})
		expect(response.ok()).toBeTruthy()
		return response.json()
	}
	await page.goto(`/tasks/${task.id}`)
	const actions = page.locator('.task-view .action-buttons')
	await expect(actions.getByRole('button', {name: 'Mark task done', exact: true})).toHaveCount(0)
	await actions.getByRole('button', {name: 'Subscribe', exact: true}).click()
	await expect(actions.getByRole('button', {name: 'Unsubscribe', exact: true})).toBeVisible()
	await page.reload()
	expect((await readTask()).subscription).toBeTruthy()
	await actions.getByRole('button', {name: 'Unsubscribe', exact: true}).click()
	await expect(actions.getByRole('button', {name: 'Subscribe', exact: true})).toBeVisible()
	await page.reload()
	expect((await readTask()).subscription).toBeFalsy()

	await actions.getByRole('button', {name: 'Add to Favorites', exact: true}).click()
	await expect(actions.getByRole('button', {name: 'Remove from Favorites', exact: true})).toBeVisible()
	await page.reload()
	expect((await readTask()).is_favorite).toBe(true)

	const projectFavorite = page.locator(`.list-menu[data-project-id="${project.id}"] .favorite`).first()
	await projectFavorite.click()
	await expect(projectFavorite).toHaveClass(/is-favorite/)
	await page.reload()
	expect((await readProject()).is_favorite).toBe(true)
	await projectFavorite.click()
	await expect(projectFavorite).not.toHaveClass(/is-favorite/)
	await page.reload()
	expect((await readProject()).is_favorite).toBe(false)

	const reactions = page.locator('.task-view .reactions.details')
	await reactions.getByRole('button', {name: 'Add your reaction'}).click()
	const picker = page.locator('.emoji-picker')
	await picker.locator('input.search').fill('thumbs up')
	const option = picker.locator('#search-results [role="option"]').first()
	await expect(option).toBeVisible()
	const value = (await option.textContent())!.trim()
	await option.click()
	const reaction = reactions.locator('.reaction-button').filter({hasText: value})
	await expect(reaction).toBeVisible()
	await page.reload()
	await expect(reaction).toBeVisible()
	let storedReactions = await apiContext.get(`tasks/${task.id}/reactions`, {headers})
	expect(storedReactions.ok()).toBeTruthy()
	expect(Object.keys(await storedReactions.json())).toEqual([value])
	await reaction.click()
	await expect(reaction).toHaveCount(0)
	await page.reload()
	storedReactions = await apiContext.get(`tasks/${task.id}/reactions`, {headers})
	expect(storedReactions.ok()).toBeTruthy()
	expect(Object.keys((await storedReactions.json()) ?? {})).toEqual([])

	await page.goto(`/projects/${project.id}/${views[0].id}`)
	const taskFavorite = page.locator('.single-task .favorite').first()
	await expect(taskFavorite).toHaveClass(/is-favorite/)
	await taskFavorite.click()
	await expect(taskFavorite).not.toHaveClass(/is-favorite/)
	await page.reload()
	expect((await readTask()).is_favorite).toBe(false)
	await expect(page.locator('.single-task input[type="checkbox"]').first()).toBeDisabled()

	await UserProjectFactory.create(1, {
		project_id: project.id,
		user_id: currentUser.id,
		permission: 0,
	})
	await page.goto(`/tasks/${task.id}`)
	await page.reload()
	await expect(page.locator('.task-view h1')).toContainText(task.title)
	await expect(actions.getByRole('button', {name: 'Subscribe', exact: true})).toHaveCount(0)
	await expect(actions.getByRole('button', {name: 'Add to Favorites', exact: true})).toHaveCount(0)
	await expect(projectFavorite).toHaveCount(0)
	await expect(reactions.getByRole('button', {name: 'Add your reaction'})).toHaveCount(0)
})
