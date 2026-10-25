from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

JOB_STATUSES = ("queued", "running", "done", "failed", "cancelled")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(f"status IN ({', '.join(repr(s) for s in JOB_STATUSES)})", name="ck_job_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    priority: Mapped[int] = mapped_column(default=5)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    total: Mapped[int] = mapped_column(default=0)
    processed: Mapped[int] = mapped_column(default=0)
    succeeded: Mapped[int] = mapped_column(default=0)
    failed: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    error: Mapped[str | None] = mapped_column(Text)
    log: Mapped[list[str]] = mapped_column(JSON, default=list)


class ProviderCache(Base):
    __tablename__ = "provider_cache"
    __table_args__ = (Index("ix_provider_cache_expires", "expires_at"),)

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(20))
    op: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict | list | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(10))  # ok | empty
    fetched_at: Mapped[datetime]
    expires_at: Mapped[datetime]


class AppSetting(Base):
    """Configuração do servidor (hoje, as chaves de API). Nunca sai inteira pela API nem pelo export."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())
