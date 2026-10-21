export type TurnstileAction = 'register' | 'password_reset'

export interface TurnstileOptions {
	sitekey: string
	action: TurnstileAction
	theme: 'auto'
	size: 'normal' | 'compact'
	'response-field': false
	retry: 'auto'
	'refresh-expired': 'manual'
	'refresh-timeout': 'manual'
	callback: (token: string) => void
	'expired-callback': () => void
	'error-callback': () => boolean
	'timeout-callback': () => void
}

export interface TurnstileAPI {
	ready: (callback: () => void) => void
	render: (container: HTMLElement, options: TurnstileOptions) => string
	reset: (widgetId: string) => void
	remove: (widgetId: string) => void
}

declare global {
	interface Window {
		turnstile?: TurnstileAPI
	}
}

let loading: Promise<TurnstileAPI> | undefined
const SCRIPT_ID = 'vikunja-turnstile-script'

export function loadTurnstile(): Promise<TurnstileAPI> {
	if (loading) return loading
	const promise = new Promise<TurnstileAPI>((resolve, reject) => {
		let script: HTMLScriptElement | null = null
		let poll: number | undefined
		const timeout = window.setTimeout(failed, 15000)

		function cleanup() {
			window.clearTimeout(timeout)
			window.clearInterval(poll)
			script?.removeEventListener('load', loaded)
			script?.removeEventListener('error', failed)
		}
		function failed() {
			cleanup()
			script?.remove()
			reject(new Error('Could not load human verification'))
		}
		function loaded() {
			const api = window.turnstile
			if (typeof api?.render !== 'function') {
				// The load event can precede Turnstile initialization; ready() can throw during that gap.
				poll ??= window.setInterval(loaded, 50)
				return
			}
			cleanup()
			resolve(api)
		}

		if (window.turnstile) {
			loaded()
			return
		}
		script = document.createElement('script')
		script.id = SCRIPT_ID
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
		script.async = true
		script.addEventListener('load', loaded)
		script.addEventListener('error', failed)
		document.head.appendChild(script)
	})
	loading = promise
	void promise.catch(() => {
		if (loading === promise) loading = undefined
	})
	return promise
}
