import {randomBytes} from 'node:crypto'
import {test, expect} from '../../support/fixtures'
import {UserFactory} from '../../factories/user'
import {setupApiUrl} from '../../support/authenticateUser'
import {apiRootUrl} from '../../support/apiUrl'
import {mockTurnstileWidget} from '../../support/turnstile'

test.describe('Registration', () => {
	test.beforeEach(async ({page}) => {
		await setupApiUrl(page)
		await UserFactory.create(1, {
			username: 'test',
		})
		await page.goto('/')
		await page.evaluate(() => localStorage.removeItem('token'))
	})

	test('Should work without issues', async ({page}) => {
		const cloudflareRequests: string[] = []
		page.on('request', request => {
			if (request.url().startsWith('https://challenges.cloudflare.com/')) cloudflareRequests.push(request.url())
		})
		const fixture = {
			username: 'testuser',
			password: '12345678',
			email: 'testuser@example.com',
		}

		// Install clock before navigation so app observes mocked time for greeting
		await page.clock.install({time: new Date(1625656161057)}) // 13:00
		await page.goto('/register')
		await page.locator('#username').fill(fixture.username)
		await page.locator('#email').fill(fixture.email)
		await page.locator('#password').fill(fixture.password)
		await page.locator('#register-submit').click()
		await expect(page).toHaveURL('/')
		await expect(page.locator('main h1')).toContainText(fixture.username)
		expect(cloudflareRequests).toEqual([])
	})

	test('Turnstile UI retries with a new token and registration persists (mock widget)', async ({page, apiContext}, testInfo) => {
		await mockTurnstileWidget(page)
		const submittedTokens: string[] = []
		page.on('request', request => {
			if (request.url().endsWith('/api/v2/register') && request.method() === 'POST') {
				submittedTokens.push(request.postDataJSON().turnstile_token)
			}
		})
		await page.setViewportSize({
			width: 320,
			height: 760,
		})
		await page.goto('/register')
		await expect(page.locator('.vikunja-loading')).toHaveCount(0)
		await page.locator('#username').fill('test')
		await page.locator('#email').fill('turnstile@example.com')
		await page.locator('#password').fill('12345678')
		const verify = page.locator('[data-turnstile-verify="register"]')
		await expect(verify).toBeVisible()
		await expect(page.locator('#register-submit')).toHaveAttribute('aria-disabled', 'true')
		await page.locator('#password').press('Enter')
		expect(submittedTokens).toEqual([])
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
		await page.screenshot({path: testInfo.outputPath('turnstile-register-mobile.png'), fullPage: true})
		await verify.click()
		await page.locator('#register-submit').click()
		await expect(page.locator('div.message.danger')).toContainText('A user with this username already exists.')
		await expect(page.locator('#register-submit')).toHaveAttribute('aria-disabled', 'true')
		await expect(page.locator('#email')).toHaveValue('turnstile@example.com')
		await page.locator('#username').fill('turnstile-user')
		await page.locator('#password').press('Enter')
		expect(submittedTokens).toHaveLength(1)
		await page.setViewportSize({
			width: 1280,
			height: 900,
		})
		await expect(verify).toBeVisible()
		await page.screenshot({path: testInfo.outputPath('turnstile-register-desktop.png'), fullPage: true})
		await verify.click()
		await page.locator('#register-submit').click()
		await expect(page).toHaveURL('/')
		expect(submittedTokens).toHaveLength(2)
		expect(submittedTokens[0]).not.toBe(submittedTokens[1])
		await page.reload()
		await expect(page.locator('main h1')).toContainText('turnstile-user')
		const login = await apiContext.post('login', {
			data: {
				username: 'turnstile-user',
				password: '12345678',
			},
		})
		expect(login.ok()).toBe(true)
		const storage = await page.evaluate(() => JSON.stringify({
			local: {...localStorage},
			session: {...sessionStorage},
		}))
		expect(storage).not.toContain('mock-turnstile-token-')
	})

	test('Should show a confirmation notice when the email needs to be verified', async ({browser, baseURL, request}) => {
		const publicUrl = new URL('/', baseURL).href
		const apiUrl = apiRootUrl(process.env.MAILER_API_URL || 'http://127.0.0.1:3457')
		const mailpitUrl = process.env.MAILPIT_URL || 'http://127.0.0.1:8025'
		const username = `unconfirmed-${randomBytes(8).toString('hex')}`
		const email = `${username}@example.com`
		const context = await browser.newContext({baseURL: publicUrl})
		try {
			await context.addInitScript(url => {
				localStorage.setItem('API_URL', url)
				window.API_URL = url
			}, apiUrl)
			const page = await context.newPage()
			await page.goto('/register')
			await page.locator('#username').fill(username)
			await page.locator('#email').fill(email)
			await page.locator('#password').fill('12345678')
			const loginUrl = `${apiUrl}/api/v2/login`
			const login = page.waitForResponse(response => response.url() === loginUrl && response.request().method() === 'POST')
			await page.locator('#register-submit').click()
			expect((await login).status()).toBe(412)
			await expect(page.locator('div.message.success')).toContainText('check your inbox')
			await expect(page.locator('div.message.danger')).not.toBeVisible()
			await expect(page).toHaveURL(/\/register/)

			let messageId = ''
			await expect.poll(async () => {
				const response = await request.get(new URL('/api/v1/search', mailpitUrl).href, {params: {query: `to:${email}`}})
				expect(response.status()).toBe(200)
				const result: {messages: {ID: string}[]} = await response.json()
				messageId = result.messages[0]?.ID ?? ''
				return messageId
			}, {timeout: 15000, message: 'Confirmation email arrives in Mailpit'}).toBeTruthy()
			const response = await request.get(new URL(`/api/v1/message/${messageId}`, mailpitUrl).href)
			expect(response.status()).toBe(200)
			const mail: {Text: string, To: {Address: string}[]} = await response.json()
			expect(mail.To).toContainEqual(expect.objectContaining({Address: email}))
			const confirmationUrl = mail.Text.match(/https?:\/\/[^\s<>]+\?userEmailConfirm=[a-zA-Z0-9]+/)?.[0]
			expect(confirmationUrl).toBeDefined()
			await page.goto(confirmationUrl!)
			await expect(page.locator('div.message.success')).toContainText('You successfully confirmed your email')
			await page.locator('#username').fill(username)
			await page.locator('#password').fill('12345678')
			await page.getByRole('button', {name: 'Login', exact: true}).click()
			await expect(page).toHaveURL(publicUrl)
			await expect(page.locator('main h1')).toContainText(username)
		} finally {
			await context.close()
		}
	})

	test('Should fail', async ({page}) => {
		const fixture = {
			username: 'test',
			password: '12345678',
			email: 'testuser@example.com',
		}

		await page.goto('/register')
		await page.locator('#username').fill(fixture.username)
		await page.locator('#email').fill(fixture.email)
		await page.locator('#password').fill(fixture.password)
		await page.locator('#register-submit').click()
		await expect(page.locator('div.message.danger')).toContainText('A user with this username already exists.')
	})
})
