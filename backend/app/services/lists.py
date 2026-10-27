"""Listas de jogos do usuário: criar, editar, pôr e tirar jogos, reordenar e seguir a mesclagem."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import GameList, GameListItem
from app.schemas import ListCreate, ListOut, ListPatch, PublicList
from app.services.games import get_game


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _text(value: str | None) -> str | None:
    return (value or "").strip() or None


def get_list(db: Session, user_id: int, list_id: int) -> GameList:
    """Lista do usuário; a de outro usuário é tratada como inexistente."""
    lst = db.get(GameList, list_id)
    if lst is None or lst.user_id != user_id:
        raise HTTPException(404, "Lista não encontrada")
    return lst


def user_lists(db: Session, user_id: int) -> list[GameList]:
    q = select(GameList).where(GameList.user_id == user_id).order_by(GameList.updated_at.desc(), GameList.id.desc())
    return list(db.scalars(q))


def to_out(lst: GameList) -> ListOut:
    return ListOut(
        id=lst.id,
        name=lst.name,
        description=lst.description,
        ranked=lst.ranked,
        public=lst.public,
        game_ids=[i.game_id for i in lst.items],
        created_at=lst.created_at,
        updated_at=lst.updated_at,
    )


def to_public(lst: GameList, visible: set[int]) -> PublicList:
    return PublicList(
        id=lst.id,
        name=lst.name,
        description=lst.description,
        ranked=lst.ranked,
        game_ids=[i.game_id for i in lst.items if i.game_id in visible],
    )


def create_list(db: Session, user_id: int, data: ListCreate) -> GameList:
    now = _now()  # com microssegundos, como os toques de updated_at: a ordem "recentes primeiro" não empata
    lst = GameList(
        user_id=user_id,
        name=data.name.strip(),
        description=_text(data.description),
        ranked=data.ranked,
        public=data.public,
        created_at=now,
        updated_at=now,
    )
    db.add(lst)
    db.commit()
    return lst


def patch_list(db: Session, lst: GameList, patch: ListPatch) -> GameList:
    for field in patch.model_fields_set:
        value = getattr(patch, field)
        if field == "name":
            if not value or not value.strip():
                continue
            value = value.strip()
        elif field == "description":
            value = _text(value)
        elif value is None:
            continue
        setattr(lst, field, value)
    lst.updated_at = _now()
    db.commit()
    return lst


def delete_list(db: Session, lst: GameList) -> None:
    db.delete(lst)
    db.commit()


def add_game(db: Session, lst: GameList, game_id: int) -> GameList:
    """Põe o jogo no fim da lista. Se ele já está lá, nada muda."""
    get_game(db, lst.user_id, game_id)
    if any(i.game_id == game_id for i in lst.items):
        return lst
    position = max((i.position for i in lst.items), default=-1) + 1
    lst.items.append(GameListItem(game_id=game_id, position=position))
    lst.updated_at = _now()
    db.commit()
    return lst


def remove_game(db: Session, lst: GameList, game_id: int) -> GameList:
    item = next((i for i in lst.items if i.game_id == game_id), None)
    if item is not None:
        lst.items.remove(item)
        lst.updated_at = _now()
        db.commit()
    return lst


def set_order(db: Session, lst: GameList, game_ids: list[int]) -> GameList:
    """Regrava as posições. A ordem nova tem de trazer exatamente os jogos que já estão na lista."""
    by_game = {i.game_id: i for i in lst.items}
    if len(game_ids) != len(set(game_ids)) or set(game_ids) != set(by_game):
        raise HTTPException(422, "A ordem nova precisa ter os mesmos jogos da lista. Recarregue a página.")
    for position, game_id in enumerate(game_ids):
        by_game[game_id].position = position
    lst.updated_at = _now()
    db.commit()
    db.refresh(lst, ["items"])
    return lst


def repoint_game(db: Session, source_id: int, target_id: int) -> None:
    """Mesclagem: o destino herda o lugar da origem nas listas em que ainda não está."""
    has_target = select(GameListItem.list_id).where(GameListItem.game_id == target_id)
    db.execute(
        update(GameListItem)
        .where(GameListItem.game_id == source_id, GameListItem.list_id.not_in(has_target))
        .values(game_id=target_id)
    )
    db.execute(delete(GameListItem).where(GameListItem.game_id == source_id))
