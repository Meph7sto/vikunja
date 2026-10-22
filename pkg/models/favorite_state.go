package models

import (
	"code.vikunja.io/api/pkg/web"
	"xorm.io/xorm"
)

// FavoriteState updates only the authenticated user's bookmark, not its entity.
type FavoriteState struct {
	IsFavorite bool         `json:"is_favorite" doc:"Whether the entity is a favorite of the authenticated user."`
	EntityID   int64        `json:"-"`
	Kind       FavoriteKind `json:"-"`

	web.CRUDable    `json:"-"`
	web.Permissions `json:"-"`
}

func (f *FavoriteState) Update(s *xorm.Session, a web.Auth) error {
	current, err := isFavorite(s, f.EntityID, a, f.Kind)
	if err != nil || current == f.IsFavorite {
		return err
	}
	if f.IsFavorite {
		return addToFavorites(s, f.EntityID, a, f.Kind)
	}
	return removeFromFavorite(s, f.EntityID, a, f.Kind)
}
