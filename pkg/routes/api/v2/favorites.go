package apiv2

import (
	"context"
	"net/http"

	"code.vikunja.io/api/pkg/models"
	"code.vikunja.io/api/pkg/web/handler"
	"github.com/danielgtaylor/huma/v2"
)

func init() { AddRouteRegistrar(RegisterFavoriteRoutes) }

func RegisterFavoriteRoutes(api huma.API) {
	Register(api, huma.Operation{
		OperationID: "tasks-favorite-update",
		Summary:     "Set a task's personal favorite state",
		Description: "Updates only the authenticated user's favorite state. Requires write access to the task's project; other task fields are not accepted. Link shares cannot have personal favorites.",
		Method:      http.MethodPut,
		Path:        "/tasks/{task}/favorite",
		Tags:        []string{"tasks"},
	}, taskFavoriteUpdate)
	Register(api, huma.Operation{
		OperationID: "projects-favorite-update",
		Summary:     "Set a project's personal favorite state",
		Description: "Updates only the authenticated user's favorite state. Requires write access to the project; other project fields are not accepted. Saved filters retain their own favorite endpoint. Link shares cannot have personal favorites.",
		Method:      http.MethodPut,
		Path:        "/projects/{id}/favorite",
		Tags:        []string{"projects"},
	}, projectFavoriteUpdate)
}

func taskFavoriteUpdate(ctx context.Context, in *struct {
	ID   int64 `path:"task"`
	Body models.FavoriteState
}) (*singleBody[models.FavoriteState], error) {
	in.Body.EntityID = in.ID
	in.Body.Kind = models.FavoriteKindTask
	return updateFavorite(ctx, &in.Body)
}

func projectFavoriteUpdate(ctx context.Context, in *struct {
	ID   int64 `path:"id"`
	Body models.FavoriteState
}) (*singleBody[models.FavoriteState], error) {
	in.Body.EntityID = in.ID
	in.Body.Kind = models.FavoriteKindProject
	return updateFavorite(ctx, &in.Body)
}

func updateFavorite(ctx context.Context, state *models.FavoriteState) (*singleBody[models.FavoriteState], error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	if err := handler.DoUpdate(ctx, state, a); err != nil {
		return nil, translateDomainError(err)
	}
	return &singleBody[models.FavoriteState]{Body: state}, nil
}
