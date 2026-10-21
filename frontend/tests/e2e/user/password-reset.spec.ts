import {setupApiUrl} from '../../support/authenticateUser'
import {test, expect} from '../../support/fixtures'
import {UserFactory, type UserAttributes} from '../../factories/user'
import {TokenFactory, type TokenAttributes} from '../../factories/token'
import {mockTurnstileWidget} from '../../support/turnstile'

test.describe('Password Reset', () => {
	let user: UserAttributes

	test.beforeEach(async ({page}) => {
		await setupApiUrl(page)
		const users = await UserFactory.create(1)
		user = users[0] as UserAttributes
	})

	test('Should allow a user to reset their password with a valid token', async ({page}) => {
		const tokenArray = await TokenFactory.create(1, {user_id: user.id as number, kind: 1})
		const token: TokenAttributes = tokenArray[0] as TokenAttributes

		await page.goto(`/?userPasswordReset=${token.token}`)
		await expect(page).toHaveURL(`/password-reset?userPasswordReset=${token.token}`)

		const newPassword = 'newSecurePassword123'
		await page.locator('input[id=password]').fill(newPassword)
		await page.locator('button').filter({hasText: 'Reset your password'}).click()

		await expect(page.locator('.message.success')).toContainText('The password was updated successfully.')
		await page.locator('.button').filter({hasText: 'Login'}).click()
		await expect(page).toHaveURL('/login')

		// Try to login with the new password
		await page.locator('input[id=username]').fill(user.username)
		await page.locator('input[id=password]').fill(newPassword)
		await page.locator('.button').filter({hasText: 'Login'}).click()
		await expect(page).toHaveURL('/')
	})

	test('Should show an error for an invalid token', async ({page}) => {
		await page.goto('/?userPasswordReset=invalidtoken123')
		await expect(page).toHaveURL('/password-reset?userPasswordReset=invalidtoken123')

		// Attempt to reset password
		const newPassword = 'newSecurePassword123'
		await page.locator('input[id=password]').fill(newPassword)
		await page.locator('button').filter({hasText: 'Reset your password'}).click()

		await expect(page.locator('.message')).toContainText('Invalid password reset token.')
	})

	test('Turnstile UI requires re-verification after a failed reset email request (mock widget)', async ({page}, testInfo) => {
		const email = 'reset-turnstile@example.com'
		await UserFactory.create(1, {email})
		await mockTurnstileWidget(page)
		const submittedTokens: string[] = []
		page.on('request', request => {
			if (request.url().endsWith('/api/v2/user/password/token') && request.method() === 'POST') {
				submittedTokens.push(request.postDataJSON().turnstile_token)
			}
		})
		await page.setViewportSize({
			width: 320,
			height: 760,
		})
		await page.goto('/get-password-reset')
		await expect(page.locator('.vikunja-loading')).toHaveCount(0)
		await page.locator('#email').fill('unknown-turnstile@example.com')
		const submit = page.getByRole('button', {name: 'Send me a password reset link'})
		const verify = page.locator('[data-turnstile-verify="password_reset"]')
		await expect(verify).toBeVisible()
		await expect(submit).toHaveAttribute('aria-disabled', 'true')
		await page.locator('#email').press('Enter')
		expect(submittedTokens).toEqual([])
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
		await page.screenshot({path: testInfo.outputPath('turnstile-password-reset-mobile.png'), fullPage: true})
		await verify.click()
		await submit.click()
		await expect(page.locator('div.message.danger')).toBeVisible()
		await expect(page.locator('#email')).toHaveValue('unknown-turnstile@example.com')
		await expect(submit).toHaveAttribute('aria-disabled', 'true')
		await page.locator('#email').fill(email)
		await page.locator('#email').press('Enter')
		expect(submittedTokens).toHaveLength(1)
		await verify.click()
		await submit.click()
		await expect(page.locator('div.message.success')).toContainText('Check your inbox')
		expect(submittedTokens).toHaveLength(2)
		expect(submittedTokens[0]).not.toBe(submittedTokens[1])
	})

	test('Should redirect to login if no token is present in query param when visiting /password-reset directly', async ({page}) => {
		await page.goto('/password-reset')
		// Wait for redirect to login page
		await expect(page).toHaveURL('/login')
	})

	test('Should redirect to login if userPasswordReset token is not present in query param when visiting root', async ({page}) => {
		await page.goto('/')
		await expect(page).toHaveURL('/login')
	})
})
