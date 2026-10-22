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

func TestHumaPersonalFavorites(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)
	s := db.NewSession()
	for i, permission := range []models.Permission{
		models.PermissionWrite,
		models.PermissionAdmin,
		models.PermissionRead,
	} {
		_, err = s.Insert(&models.ProjectUser{
			ProjectID:  1,
			UserID:     int64(i + 2),
			Permission: permission,
		})
		require.NoError(t, err)
	}
	require.NoError(t, s.Commit())
	require.NoError(t, s.Close())

	for _, entity := range []struct {
		path string
		kind models.FavoriteKind
	}{
		{
			path: "tasks",
			kind: models.FavoriteKindTask,
		},
		{
			path: "projects",
			kind: models.FavoriteKindProject,
		},
	} {
		t.Run(entity.path, func(t *testing.T) {
			url := fmt.Sprintf("/api/v2/%s/1/favorite", entity.path)
			for _, userID := range []int64{
				1,
				2,
				3,
			} {
				token := humaTokenFor(t, &user.User{ID: userID})
				for range 2 {
					rec := humaRequest(t, e, http.MethodPut, url, `{"is_favorite":true}`, token, "")
					require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
					assert.Contains(t, rec.Body.String(), `"is_favorite":true`)
				}
				db.AssertExists(t, "favorites", map[string]interface{}{
					"entity_id": 1,
					"user_id":   userID,
					"kind":      entity.kind,
				}, false)
			}
			writer := humaTokenFor(t, &user.User{ID: 2})
			for _, payload := range []string{
				`{"is_favorite":false,"user_id":1}`,
				`{"is_favorite":false,"title":"changed","done":true}`,
				`{"is_favorite":false,"project_id":2}`,
			} {
				rec := humaRequest(t, e, http.MethodPut, url, payload, writer, "")
				assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
			}
			for _, userID := range []int64{
				4,
				5,
			} {
				token := humaTokenFor(t, &user.User{ID: userID})
				rec := humaRequest(t, e, http.MethodPut, url, `{"is_favorite":true}`, token, "")
				assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
			}
			for range 2 {
				rec := humaRequest(t, e, http.MethodPut, url, `{"is_favorite":false}`, writer, "")
				require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			}
			db.AssertMissing(t, "favorites", map[string]interface{}{
				"entity_id": 1,
				"user_id":   2,
				"kind":      entity.kind,
			})
			db.AssertExists(t, "favorites", map[string]interface{}{
				"entity_id": 1,
				"user_id":   1,
				"kind":      entity.kind,
			}, false)
			rec := humaRequest(t, e, http.MethodPatch, fmt.Sprintf("/api/v2/%s/1", entity.path),
				`{"is_favorite":true,"title":"changed"}`, writer, "")
			assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		})
	}
	db.AssertExists(t, "tasks", map[string]interface{}{
		"id":    1,
		"title": "task #1",
	}, false)
	db.AssertExists(t, "projects", map[string]interface{}{
		"id":    1,
		"title": "Test1",
	}, false)

	writer := humaTokenFor(t, &user.User{ID: 2})
	for _, entity := range []string{
		"tasks",
		"projects",
	} {
		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf("/api/v2/%s/1/favorite", entity),
			`{"is_favorite":true}`, writer, "")
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}
	s = db.NewSession()
	_, err = s.Where("user_id = ? AND project_id = ?", 2, 1).Delete(&models.ProjectUser{})
	require.NoError(t, err)
	require.NoError(t, s.Commit())
	require.NoError(t, s.Close())
	for _, entity := range []string{
		"tasks",
		"projects",
	} {
		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf("/api/v2/%s/1/favorite", entity),
			`{"is_favorite":false}`, writer, "")
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	}
}
