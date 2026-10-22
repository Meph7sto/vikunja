import type {Task} from '@/client/generated'
import {PERMISSIONS} from '@/constants/permissions'
import {useCurrentProject} from '@/composables/useCurrentProject'
import {useProjects} from '@/composables/useProjects'

export function useTaskPermissions() {
	const projectList = useProjects()
	const {currentProject} = useCurrentProject()

	function getProject(task: Pick<Task, 'project_id'> | undefined) {
		if (!task?.project_id) return undefined
		return currentProject.value?.id === task.project_id
			? currentProject.value
			: projectList.projects[task.project_id]
	}

	function canManageTask(task: Pick<Task, 'project_id'> | undefined): boolean {
		const project = getProject(task)
		return project?.max_permission === PERMISSIONS.ADMIN && !project.is_archived
	}

	function canContributeToTask(task: Pick<Task, 'project_id'> | undefined): boolean {
		const project = getProject(task)
		return (project?.max_permission ?? PERMISSIONS.READ) > PERMISSIONS.READ && !project?.is_archived
	}

	return {
		canManageTask,
		canContributeToTask,
	}
}
