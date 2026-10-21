import {describe, expect, it} from 'vitest'
import {getProjectTitle} from './getProjectTitle'

describe('getProjectTitle', () => {
	it('leaves explicitly created Inbox projects as ordinary user-named projects', () => {
		const project = {
			id: 1,
			title: 'Inbox',
		}
		expect(getProjectTitle(project)).toBe('Inbox')
		expect(project.title).toBe('Inbox')
	})

	it('preserves custom project names', () => {
		expect(getProjectTitle({
			id: 2,
			title: 'Work',
		})).toBe('Work')
	})
})
