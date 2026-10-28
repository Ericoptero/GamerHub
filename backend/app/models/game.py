from datetime import date, datetime

from sqlalchemy import JSON, CheckConstraint, Float, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.domain import ACCESS, LINK_STATUSES, PRIORITIES, STATUSES
from app.models.catalog import Genre, Platform, Store, game_stores


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN ({', '.join(repr(v) for v in values)})"


class Game(Base):
    __tablename__ = "games"
    __table_args__ = (
        CheckConstraint(_in("status", STATUSES), name="ck_games_status"),
        CheckConstraint(f"priority IS NULL OR {_in('priority', PRIORITIES)}", name="ck_games_priority"),
        CheckConstraint(_in("access", ACCESS), name="ck_games_access"),
        CheckConstraint("user_score IS NULL OR user_score BETWEEN 1 AND 10", name="ck_games_user_score"),
        Index("ix_games_status", "status"),
        Index("ix_games_name_norm", "name_norm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    name_norm: Mapped[str] = mapped_column(String(300))
    platform_id: Mapped[int] = mapped_column(ForeignKey("platforms.id", ondelete="RESTRICT"))
    genre_id: Mapped[int | None] = mapped_column(ForeignKey("genres.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="backlog")
    priority: Mapped[str | None] = mapped_column(String(10))
    # Posse (domain.ACCESS): "owned" é o normal; os outros ganham um ícone no card.
    access: Mapped[str] = mapped_column(String(12), default="owned")
    # Fora de todas as listas; só aparece em "Ocultos".
    hidden: Mapped[bool] = mapped_column(default=False)

    hltb_main_hours: Mapped[float | None] = mapped_column(Float)
    hltb_extra_hours: Mapped[float | None] = mapped_column(Float)
    hltb_complete_hours: Mapped[float | None] = mapped_column(Float)
    played_hours: Mapped[float | None] = mapped_column(Float)
    # None: legado/desconhecido · "store": somado das contas de loja · "user": digitado (a loja não mexe mais).
    played_hours_source: Mapped[str | None] = mapped_column(String(10))

    user_score: Mapped[int | None]
    review_text: Mapped[str | None] = mapped_column(Text)
    story_summary: Mapped[str | None] = mapped_column(Text)
    times_completed: Mapped[int | None]
    finished_at: Mapped[date | None]
    finished_label: Mapped[str | None] = mapped_column(String(80))
    release_date: Mapped[date | None]

    description: Mapped[str | None] = mapped_column(Text)
    storyline: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(String(1000))
    cover_path: Mapped[str | None] = mapped_column(String(300))
    background_url: Mapped[str | None] = mapped_column(String(1000))
    background_path: Mapped[str | None] = mapped_column(String(300))
    metacritic_score: Mapped[int | None]
    metacritic_user_score: Mapped[float | None] = mapped_column(Float)
    metacritic_url: Mapped[str | None] = mapped_column(String(500))
    metacritic_source: Mapped[str | None] = mapped_column(String(20))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    developer: Mapped[str | None] = mapped_column(String(200))
    publisher: Mapped[str | None] = mapped_column(String(200))

    origin: Mapped[str] = mapped_column(String(20), default="manual")
    locked_fields: Mapped[list[str]] = mapped_column(JSON, default=list)
    import_key: Mapped[str | None] = mapped_column(String(400))
    import_order: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )
    last_enriched_at: Mapped[datetime | None]

    platform: Mapped[Platform] = relationship(lazy="joined")
    genre: Mapped[Genre | None] = relationship(lazy="joined")
    stores: Mapped[list[Store]] = relationship(secondary=game_stores, order_by=Store.name, lazy="selectin")
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="game", cascade="all, delete-orphan", order_by="Comment.created_at"
    )
    media: Mapped[list["Media"]] = relationship(
        back_populates="game", cascade="all, delete-orphan", order_by=lambda: (Media.kind, Media.position)
    )
    store_reviews: Mapped[list["StoreReview"]] = relationship(
        back_populates="game", cascade="all, delete-orphan", order_by="StoreReview.id"
    )
    links: Mapped[list["ExternalLink"]] = relationship(
        back_populates="game", cascade="all, delete-orphan", order_by="ExternalLink.provider"
    )


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())
    updated_at: Mapped[datetime | None]

    game: Mapped[Game] = relationship(back_populates="comments")


class Media(Base):
    __tablename__ = "media"
    __table_args__ = (UniqueConstraint("game_id", "kind", "url", name="uq_media_game_kind_url"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # screenshot | video | artwork
    url: Mapped[str] = mapped_column(String(1000))
    thumb_url: Mapped[str | None] = mapped_column(String(1000))
    local_path: Mapped[str | None] = mapped_column(String(300))
    thumb_path: Mapped[str | None] = mapped_column(String(300))
    provider: Mapped[str] = mapped_column(String(20), default="manual")
    provider_ref: Mapped[str | None] = mapped_column(String(200))
    title: Mapped[str | None] = mapped_column(String(300))
    position: Mapped[int] = mapped_column(default=0)

    game: Mapped[Game] = relationship(back_populates="media")


class StoreReview(Base):
    __tablename__ = "store_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(80))
    outlet: Mapped[str | None] = mapped_column(String(200))
    author: Mapped[str | None] = mapped_column(String(200))
    score_display: Mapped[str | None] = mapped_column(String(40))
    score_norm: Mapped[int | None]
    text: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(1000))
    review_date: Mapped[date | None]
    provider: Mapped[str] = mapped_column(String(20))
    fetched_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())

    game: Mapped[Game] = relationship(back_populates="store_reviews")


class ExternalLink(Base):
    __tablename__ = "external_links"
    __table_args__ = (
        UniqueConstraint("game_id", "provider", name="uq_link_game_provider"),
        CheckConstraint(_in("status", LINK_STATUSES), name="ck_link_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str | None] = mapped_column(String(200))
    external_url: Mapped[str | None] = mapped_column(String(500))
    matched_name: Mapped[str | None] = mapped_column(String(300))
    match_score: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20))
    candidates: Mapped[list[dict]] = mapped_column(JSON, default=list)
    last_synced_at: Mapped[datetime | None]
    last_error: Mapped[str | None] = mapped_column(Text)

    game: Mapped[Game] = relationship(back_populates="links")
