from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.auth.deps import current_user
from app.db import get_db
from app.models import User
from app.schemas import ListAddIn, ListCreate, ListGamesIn, ListOut, ListPatch
from app.services import lists as svc

router = APIRouter(prefix="/api", tags=["lists"])


@router.get("/lists", response_model=list[ListOut])
def list_lists(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [svc.to_out(lst) for lst in svc.user_lists(db, user.id)]


@router.post("/lists", response_model=ListOut, status_code=201)
def create_list(data: ListCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return svc.to_out(svc.create_list(db, user.id, data))


@router.get("/lists/{list_id}", response_model=ListOut)
def get_list(list_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return svc.to_out(svc.get_list(db, user.id, list_id))


@router.patch("/lists/{list_id}", response_model=ListOut)
def patch_list(list_id: int, patch: ListPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return svc.to_out(svc.patch_list(db, svc.get_list(db, user.id, list_id), patch))


@router.delete("/lists/{list_id}", status_code=204)
def delete_list(list_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    svc.delete_list(db, svc.get_list(db, user.id, list_id))
    return Response(status_code=204)


@router.post("/lists/{list_id}/games", response_model=ListOut, status_code=201)
def add_game(list_id: int, data: ListAddIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return svc.to_out(svc.add_game(db, svc.get_list(db, user.id, list_id), data.game_id))


@router.put("/lists/{list_id}/games", response_model=ListOut)
def reorder(list_id: int, data: ListGamesIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return svc.to_out(svc.set_order(db, svc.get_list(db, user.id, list_id), data.game_ids))


@router.delete("/lists/{list_id}/games/{game_id}", response_model=ListOut)
def remove_game(list_id: int, game_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return svc.to_out(svc.remove_game(db, svc.get_list(db, user.id, list_id), game_id))
