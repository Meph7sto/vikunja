import type {Page} from '@playwright/test'

// The widget is simulated; business requests still reach the isolated test API.
export async function mockTurnstileWidget(page: Page) {
	await page.route('**/api/v2/info', async route => {
		const response = await route.fetch()
		const config = await response.json()
		await route.fulfill({
			response,
			json: {
				...config,
				turnstile: {
					enabled: true,
					site_key: 'mock-public-key',
				},
			},
		})
	})
	await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => route.fulfill({
		contentType: 'application/javascript',
		body: `
			(() => {
				const widgets = new Map();
				let counter = 0;
				window.turnstile = {
					ready: callback => callback(),
					render(container, options) {
						const id = String(++counter);
						const button = document.createElement('button');
						button.type = 'button';
						button.textContent = 'Verify';
						button.dataset.turnstileVerify = options.action;
						button.style.width = options.size === 'compact' ? '150px' : '300px';
						button.style.height = options.size === 'compact' ? '140px' : '65px';
						button.addEventListener('click', () => {
							button.textContent = 'Verified';
							options.callback('mock-turnstile-token-' + (++counter));
						});
						container.appendChild(button);
						widgets.set(id, {container, button});
						return id;
					},
					reset(id) {
						widgets.get(id).button.textContent = 'Verify';
					},
					remove(id) {
						widgets.get(id)?.container.replaceChildren();
						widgets.delete(id);
					}
				};
			})();
		`,
	}))
}
