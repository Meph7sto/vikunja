package webtests

import (
	"fmt"
	"net/http"
	"testing"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"
	"code.vikunja.io/api/pkg/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubmissionPermissionsHTTP(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)
	s := db.NewSession()
	_, err = s.Insert(&models.ProjectUser{
		ProjectID:  1,
		UserID:     2,
		Permission: models.PermissionWrite,
	})
	require.NoError(t, err)
	require.NoError(t, s.Commit())
	require.NoError(t, s.Close())
	writer := humaTokenFor(t, &user.User{ID: 2})
	admin := humaTokenFor(t, &testuser1)

	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{
			http.MethodPost,
			"/api/v2/projects/1/tasks",
			`{"title":"forbidden"}`,
		},
		{
			http.MethodPut,
			"/api/v2/tasks/1",
			`{"title":"forbidden","done":true}`,
		},
		{
			http.MethodPatch,
			"/api/v2/tasks/1",
			`{"done":true,"percent_done":1,"priority":5}`,
		},
		{
			http.MethodDelete,
			"/api/v2/tasks/1",
			"",
		},
		{
			http.MethodPost,
			"/api/v2/tasks/1/assignees",
			`{"user_id":2}`,
		},
		{
			http.MethodDelete,
			"/api/v2/tasks/1/assignees/1",
			"",
		},
		{
			http.MethodPost,
			"/api/v2/projects/1/views/4/buckets",
			`{"title":"forbidden"}`,
		},
		{
			http.MethodPut,
			"/api/v2/projects/1/views/4/buckets/1",
			`{"title":"forbidden"}`,
		},
		{
			http.MethodDelete,
			"/api/v2/projects/1/views/4/buckets/1",
			"",
		},
		{
			http.MethodPatch,
			"/api/v2/projects/1",
			`{"title":"forbidden","is_archived":true}`,
		},
		{
			http.MethodPost,
			"/api/v2/projects",
			`{"title":"forbidden","parent_project_id":1}`,
		},
		{
			http.MethodPut,
			"/api/v1/projects/1/tasks",
			`{"title":"forbidden"}`,
		},
		{
			http.MethodPost,
			"/api/v1/tasks/1",
			`{"title":"forbidden","done":true}`,
		},
		{
			http.MethodDelete,
			"/api/v1/tasks/1",
			"",
		},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			rec := humaRequest(t, e, tc.method, tc.path, tc.body, writer, "")
			assert.Equal(t, http.StatusForbidden, rec.Code, "%s", rec.Body.String())
		})
	}
	s = db.NewSession()
	stored, err := models.GetTaskByIDSimple(s, 1)
	require.NoError(t, err)
	require.NoError(t, s.Close())
	assert.Equal(t, "task #1", stored.Title)
	assert.False(t, stored.Done)
	assert.Zero(t, stored.Priority)

	rec := humaRequest(t, e, http.MethodPatch, "/api/v2/tasks/1", `{"percent_done":0.5}`, admin, "")
	require.Equal(t, http.StatusOK, rec.Code, "%s", rec.Body.String())
	db.AssertExists(t, "tasks", map[string]interface{}{
		"id":           1,
		"percent_done": 0.5,
	}, false)

	for _, version := range []string{
		"v1",
		"v2",
	} {
		t.Run("attachment ownership "+version, func(t *testing.T) {
			own := uploadOneAttachment(t, e, writer, "own.txt", []byte("writer's file"))
			other := uploadOneAttachment(t, e, admin, "other.txt", []byte("admin's file"))
			path := fmt.Sprintf("/api/%s/tasks/1/attachments/", version)
			rec := humaRequest(t, e, http.MethodDelete, fmt.Sprintf("%s%d", path, other), "", writer, "")
			require.Equal(t, http.StatusForbidden, rec.Code, "%s", rec.Body.String())
			db.AssertExists(t, "task_attachments", map[string]interface{}{"id": other}, false)
			rec = humaRequest(t, e, http.MethodDelete, fmt.Sprintf("%s%d", path, own), "", writer, "")
			require.Contains(t, []int{
				http.StatusOK,
				http.StatusNoContent,
			}, rec.Code, "%s", rec.Body.String())
			db.AssertMissing(t, "task_attachments", map[string]interface{}{"id": own})
			rec = humaRequest(t, e, http.MethodDelete, fmt.Sprintf("%s%d", path, other), "", admin, "")
			require.Contains(t, []int{
				http.StatusOK,
				http.StatusNoContent,
			}, rec.Code, "%s", rec.Body.String())
		})
	}

	rec = humaRequest(t, e, http.MethodPost, "/api/v2/tasks/1/comments", `{"comment":"materials submitted"}`, writer, "")
	require.Equal(t, http.StatusCreated, rec.Code, "%s", rec.Body.String())
	db.AssertExists(t, "task_comments", map[string]interface{}{
		"task_id":   1,
		"author_id": 2,
		"comment":   "materials submitted",
	}, false)
}
