package models

import (
	"code.vikunja.io/api/pkg/web"
	"xorm.io/xorm"
)

func (f *FavoriteState) CanUpdate(s *xorm.Session, a web.Auth) (bool, error) {
	if _, isShare := a.(*LinkSharing); isShare || f.EntityID < 1 {
		return false, nil
	}
	switch f.Kind {
	case FavoriteKindTask:
		return (&Task{ID: f.EntityID}).CanWrite(s, a)
	case FavoriteKindProject:
		return (&Project{ID: f.EntityID}).CanWrite(s, a)
	default:
		return false, nil
	}
}
