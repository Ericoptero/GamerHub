from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class GameList(Base):
    """Lista criada pelo usuário ("Top RPGs", "Para 2027"), à parte do status de cada jogo."""

    __tablename__ = "lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    # Ranqueada: a posição é um ranking (#1, #2…) e aparece nos cards.
    ranked: Mapped[bool] = mapped_column(default=False)
    # Aparece na página pública (/<username>) quando ela está ligada.
    public: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())
    # Também muda quando entra, sai ou muda de lugar um jogo: a tela de listas ordena por ele.
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    items: Mapped[list["GameListItem"]] = relationship(
        back_populates="list", cascade="all, delete-orphan", order_by="GameListItem.position"
    )


class GameListItem(Base):
    __tablename__ = "list_items"
    __table_args__ = (UniqueConstraint("list_id", "game_id", name="uq_list_items_list_game"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), index=True)
    # Apagar o jogo tira ele de todas as listas.
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(default=0)
    added_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())

    list: Mapped[GameList] = relationship(back_populates="items")
