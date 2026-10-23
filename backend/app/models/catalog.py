from datetime import datetime

from sqlalchemy import Column, ForeignKey, String, Table, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

device_platforms = Table(
    "device_platforms",
    Base.metadata,
    Column("device_id", ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True),
    Column("platform_id", ForeignKey("platforms.id", ondelete="CASCADE"), primary_key=True),
)

game_stores = Table(
    "game_stores",
    Base.metadata,
    Column("game_id", ForeignKey("games.id", ondelete="CASCADE"), primary_key=True),
    Column("store_id", ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True),
)


class Platform(Base):
    __tablename__ = "platforms"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    igdb_platform_id: Mapped[int | None]
    rawg_platform_id: Mapped[int | None]
    metacritic_name: Mapped[str | None] = mapped_column(String(80))
    hltb_name: Mapped[str | None] = mapped_column(String(80))


class Genre(Base):
    __tablename__ = "genres"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80, collation="NOCASE"), unique=True)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(40))
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())

    platforms: Mapped[list[Platform]] = relationship(
        secondary=device_platforms, order_by=Platform.name, lazy="selectin"
    )
