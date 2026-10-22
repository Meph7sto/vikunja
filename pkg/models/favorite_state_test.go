package models

import (
	"testing"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFavoriteStatePermissions(t *testing.T) {
	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	defer s.Close()
	u := &user.User{ID: 1}
	for _, tc := range []struct {
		name    string
		id      int64
		kind    FavoriteKind
		allowed bool
	}{
		{
			name:    "owned task",
			id:      1,
			kind:    FavoriteKindTask,
			allowed: true,
		},
		{
			name:    "write-shared task",
			id:      19,
			kind:    FavoriteKindTask,
			allowed: true,
		},
		{
			name: "read-only task",
			id:   18,
			kind: FavoriteKindTask,
		},
		{
			name:    "team-shared project",
			id:      7,
			kind:    FavoriteKindProject,
			allowed: true,
		},
		{
			name:    "inherited write project",
			id:      13,
			kind:    FavoriteKindProject,
			allowed: true,
		},
		{
			name: "read-only project",
			id:   9,
			kind: FavoriteKindProject,
		},
		{
			name: "inaccessible project",
			id:   2,
			kind: FavoriteKindProject,
		},
		{
			name: "pseudo project",
			id:   -1,
			kind: FavoriteKindProject,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			favorite := &FavoriteState{
				EntityID: tc.id,
				Kind:     tc.kind,
			}
			allowed, err := favorite.CanUpdate(s, u)
			require.NoError(t, err)
			assert.Equal(t, tc.allowed, allowed)
		})
	}
	favorite := &FavoriteState{
		EntityID: 1,
		Kind:     FavoriteKindTask,
	}
	allowed, err := favorite.CanUpdate(s, &LinkSharing{
		ID:         2,
		ProjectID:  1,
		Permission: PermissionAdmin,
	})
	require.NoError(t, err)
	assert.False(t, allowed)
	_, err = s.ID(1).Cols("is_archived").Update(&Project{IsArchived: true})
	require.NoError(t, err)
	_, err = favorite.CanUpdate(s, u)
	assert.True(t, IsErrProjectIsArchived(err))
}
