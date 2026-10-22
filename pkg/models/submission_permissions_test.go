package models

import (
	"testing"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/web"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"xorm.io/xorm"
)

func setupSubmissionPermissions(t *testing.T) *xorm.Session {
	t.Helper()
	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	t.Cleanup(func() { _ = s.Close() })
	for i, permission := range []Permission{
		PermissionWrite,
		PermissionAdmin,
		PermissionRead,
	} {
		_, err := s.Insert(&ProjectUser{
			ProjectID:  1,
			UserID:     int64(i + 2),
			Permission: permission,
		})
		require.NoError(t, err)
	}
	return s
}

func TestSubmissionPermissions_Management(t *testing.T) {
	s := setupSubmissionPermissions(t)
	checks := map[string]func(web.Auth) (bool, error){
		"create task": func(a web.Auth) (bool, error) {
			return (&Task{ProjectID: 1}).CanCreate(s, a)
		},
		"update task": func(a web.Auth) (bool, error) {
			return (&Task{ID: 1}).CanUpdate(s, a)
		},
		"delete task": func(a web.Auth) (bool, error) {
			return (&Task{ID: 1}).CanDelete(s, a)
		},
		"bulk create": func(a web.Auth) (bool, error) {
			return (&BulkTaskCreation{ProjectID: 1}).CanCreate(s, a)
		},
		"bulk update": func(a web.Auth) (bool, error) {
			return (&BulkTask{
				TaskIDs: []int64{1},
				Fields:  []string{"done"},
			}).CanUpdate(s, a)
		},
		"assign": func(a web.Auth) (bool, error) {
			return (&TaskAssginee{TaskID: 1}).CanCreate(s, a)
		},
		"unassign": func(a web.Auth) (bool, error) {
			return (&TaskAssginee{TaskID: 1}).CanDelete(s, a)
		},
		"bulk assign": func(a web.Auth) (bool, error) {
			return (&BulkAssignees{TaskID: 1}).CanCreate(s, a)
		},
		"create bucket": func(a web.Auth) (bool, error) {
			return (&Bucket{
				ProjectID:     1,
				ProjectViewID: 4,
			}).CanCreate(s, a)
		},
		"update bucket": func(a web.Auth) (bool, error) {
			return (&Bucket{
				ID:        1,
				ProjectID: 1,
			}).CanUpdate(s, a)
		},
		"delete bucket": func(a web.Auth) (bool, error) {
			return (&Bucket{
				ID:        1,
				ProjectID: 1,
			}).CanDelete(s, a)
		},
		"move task between buckets": func(a web.Auth) (bool, error) {
			return (&TaskBucket{
				TaskID:        1,
				BucketID:      1,
				ProjectID:     1,
				ProjectViewID: 4,
			}).CanUpdate(s, a)
		},
		"update project": func(a web.Auth) (bool, error) {
			return (&Project{ID: 1}).CanUpdate(s, a)
		},
		"archive project": func(a web.Auth) (bool, error) {
			return (&Project{
				ID:         1,
				IsArchived: true,
			}).CanUpdate(s, a)
		},
		"create subproject": func(a web.Auth) (bool, error) {
			return (&Project{ParentProjectID: Ptr(int64(1))}).CanCreate(s, a)
		},
	}
	for _, actor := range []struct {
		name    string
		auth    web.Auth
		allowed bool
	}{
		{
			name:    "owner",
			auth:    &user.User{ID: 1},
			allowed: true,
		},
		{
			name: "writer",
			auth: &user.User{ID: 2},
		},
		{
			name:    "admin",
			auth:    &user.User{ID: 3},
			allowed: true,
		},
		{
			name: "reader",
			auth: &user.User{ID: 4},
		},
		{
			name: "unrelated",
			auth: &user.User{ID: 5},
		},
		{
			name: "write link",
			auth: &LinkSharing{
				ID:         2,
				ProjectID:  1,
				Permission: PermissionWrite,
			},
		},
		{
			name: "admin link",
			auth: &LinkSharing{
				ID:         3,
				ProjectID:  1,
				Permission: PermissionAdmin,
			},
			allowed: true,
		},
	} {
		t.Run(actor.name, func(t *testing.T) {
			for name, check := range checks {
				t.Run(name, func(t *testing.T) {
					allowed, err := check(actor.auth)
					require.NoError(t, err)
					assert.Equal(t, actor.allowed, allowed)
				})
			}
		})
	}
}

func TestSubmissionPermissions_Contributions(t *testing.T) {
	s := setupSubmissionPermissions(t)
	_, err := s.ID(1).Cols("created_by_id").Update(&TaskAttachment{CreatedByID: 2})
	require.NoError(t, err)
	_, err = s.ID(1).Cols("author_id").Update(&TaskComment{AuthorID: 2})
	require.NoError(t, err)

	for _, actor := range []struct {
		name      string
		auth      web.Auth
		submit    bool
		deleteOwn bool
		deleteAny bool
	}{
		{
			name:      "writer",
			auth:      &user.User{ID: 2},
			submit:    true,
			deleteOwn: true,
		},
		{
			name:      "admin",
			auth:      &user.User{ID: 3},
			submit:    true,
			deleteOwn: true,
			deleteAny: true,
		},
		{
			name: "reader",
			auth: &user.User{ID: 4},
		},
		{
			name: "unrelated",
			auth: &user.User{ID: 5},
		},
	} {
		t.Run(actor.name, func(t *testing.T) {
			allowed, err := (&TaskAttachment{TaskID: 1}).CanCreate(s, actor.auth)
			require.NoError(t, err)
			assert.Equal(t, actor.submit, allowed, "upload")
			allowed, err = (&TaskComment{TaskID: 1}).CanCreate(s, actor.auth)
			require.NoError(t, err)
			assert.Equal(t, actor.submit, allowed, "comment")
			allowed, err = (&TaskAttachment{
				ID:     1,
				TaskID: 1,
			}).CanDelete(s, actor.auth)
			require.NoError(t, err)
			assert.Equal(t, actor.deleteOwn, allowed, "writer's attachment")
			allowed, err = (&TaskAttachment{
				ID:          3,
				TaskID:      1,
				CreatedByID: actor.auth.GetID(),
			}).CanDelete(s, actor.auth)
			require.NoError(t, err)
			assert.Equal(t, actor.deleteAny, allowed, "another uploader; ignore supplied author")
		})
	}
	writer := &user.User{ID: 2}
	allowed, err := (&TaskComment{
		ID:     1,
		TaskID: 1,
	}).CanUpdate(s, writer)
	require.NoError(t, err)
	assert.True(t, allowed)
	allowed, err = (&TaskComment{
		ID:     1,
		TaskID: 1,
	}).CanDelete(s, writer)
	require.NoError(t, err)
	assert.True(t, allowed)
	allowed, err = (&TaskAttachment{
		ID:     1,
		TaskID: 2,
	}).CanDelete(s, writer)
	assert.False(t, allowed)
	assert.Error(t, err, "attachment must belong to the task in the URL")
}

func TestSubmissionPermissions_Inherited(t *testing.T) {
	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	defer s.Close()
	u := &user.User{ID: 1}
	for _, tc := range []struct {
		projectID int64
		manage    bool
	}{
		{projectID: 13}, // write inherited from parent 28
		{
			projectID: 14,
			manage:    true,
		}, // admin inherited from parent 29
		{projectID: 16}, // write inherited from the team on parent 33
		{
			projectID: 17,
			manage:    true,
		}, // admin inherited from the team on parent 34
	} {
		p := &Project{ID: tc.projectID}
		allowed, err := p.CanUpdate(s, u)
		require.NoError(t, err)
		assert.Equal(t, tc.manage, allowed, "project %d", tc.projectID)
		allowed, err = p.CanWrite(s, u)
		require.NoError(t, err)
		assert.True(t, allowed, "contributions remain writable")
	}
}

func TestSubmissionPermissions_ProjectManagement(t *testing.T) {
	s := setupSubmissionPermissions(t)
	writer := &user.User{ID: 2}
	admin := &user.User{ID: 3}
	for _, a := range []*user.User{
		writer,
		admin,
	} {
		allowed, err := (&Webhook{ProjectID: 1}).CanCreate(s, a)
		require.NoError(t, err)
		assert.Equal(t, a.ID == admin.ID, allowed)
	}

	// Owning the moved project does not grant administration on its new parent.
	project := &Project{OwnerID: writer.ID}
	_, err := s.Insert(project)
	require.NoError(t, err)
	allowed, err := (&Project{
		ID:              project.ID,
		ParentProjectID: Ptr(int64(1)),
	}).CanUpdate(s, writer)
	assert.False(t, allowed)
	assert.Error(t, err)

	_, err = s.ID(1).Cols("is_archived").Update(&Project{IsArchived: true})
	require.NoError(t, err)
	allowed, err = (&Project{ID: 1}).CanUpdate(s, writer)
	require.NoError(t, err)
	assert.False(t, allowed, "a writer cannot unarchive the project")
	allowed, err = (&Project{ID: 1}).CanUpdate(s, admin)
	require.NoError(t, err)
	assert.True(t, allowed, "an admin can unarchive the project")
}

func TestSubmissionPermissions_AttachmentIdentity(t *testing.T) {
	s := setupSubmissionPermissions(t)
	share := &LinkSharing{
		ID:         2,
		ProjectID:  1,
		Permission: PermissionWrite,
	}
	_, err := s.ID(1).Cols("created_by_id").Update(&TaskAttachment{CreatedByID: share.GetID()})
	require.NoError(t, err)
	attachment := &TaskAttachment{
		ID:     1,
		TaskID: 1,
	}
	allowed, err := attachment.CanDelete(s, share)
	require.NoError(t, err)
	assert.True(t, allowed)
	allowed, err = attachment.CanCreate(s, share)
	require.NoError(t, err)
	assert.True(t, allowed)
	allowed, err = attachment.CanDelete(s, &user.User{ID: 2})
	require.NoError(t, err)
	assert.False(t, allowed, "a user ID must not match the same numbered link share")
	share.ID = 4
	allowed, err = attachment.CanDelete(s, share)
	require.NoError(t, err)
	assert.False(t, allowed, "another write link cannot delete the upload")

	_, err = s.ID(1).Cols("created_by_id").Update(&TaskAttachment{CreatedByID: 4})
	require.NoError(t, err)
	allowed, err = attachment.CanDelete(s, &user.User{ID: 4})
	require.NoError(t, err)
	assert.False(t, allowed, "a downgraded reader cannot delete even their own upload")
}
