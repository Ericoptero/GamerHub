from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.domain import LIBRARY_STORES

ACCOUNT_STATUSES = ("never", "ok", "error", "reauth")


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN ({', '.join(repr(v) for v in values)})"


class LibraryAccount(Base):
    """Conta de uma loja (Steam, Epic, GOG) cujos jogos entram na biblioteca do usuário."""

    __tablename__ = "library_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "store", "external_user_id", name="uq_account_user_store_ext"),
        CheckConstraint(_in("store", LIBRARY_STORES), name="ck_account_store"),
        CheckConstraint(_in("status", ACCOUNT_STATUSES), name="ck_account_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    store: Mapped[str] = mapped_column(String(10))
    nickname: Mapped[str] = mapped_column(String(40))
    external_user_id: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str | None] = mapped_column(String(120))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    profile_url: Mapped[str | None] = mapped_column(String(500))
    # Epic/GOG: refresh token (gira a cada uso). Nunca sai pela API nem pelo export.json.
    credentials: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(default=True)
    status: Mapped[str] = mapped_column(String(10), default="never")
    last_sync_at: Mapped[datetime | None]
    last_attempt_at: Mapped[datetime | None]
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())


class LibraryItem(Base):
    """Um jogo numa conta de loja. Vários itens (de contas diferentes) podem apontar para o mesmo jogo."""

    __tablename__ = "library_items"
    __table_args__ = (UniqueConstraint("account_id", "external_id", name="uq_item_account_ext"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("library_accounts.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(100))  # appid / catalogItemId / product id
    name: Mapped[str] = mapped_column(String(300))
    playtime_minutes: Mapped[int | None]
    last_played_at: Mapped[datetime | None]
    cover_url: Mapped[str | None] = mapped_column(String(1000))
    url: Mapped[str | None] = mapped_column(String(500))
    igdb_id: Mapped[int | None]
    game_id: Mapped[int | None] = mapped_column(ForeignKey("games.id", ondelete="SET NULL"), index=True)
    # O usuário apagou o jogo: a sincronização não o recria (nem por outra conta da mesma loja).
    ignored: Mapped[bool] = mapped_column(default=False)
    first_seen_at: Mapped[datetime]
    last_seen_at: Mapped[datetime]

    account: Mapped[LibraryAccount] = relationship(lazy="joined")
