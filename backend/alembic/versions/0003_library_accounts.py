"""contas de loja (Steam, Epic, GOG) e os jogos de cada conta

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-23 13:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "library_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("store", sa.String(length=10), nullable=False),
        sa.Column("nickname", sa.String(length=40), nullable=False),
        sa.Column("external_user_id", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("profile_url", sa.String(length=500), nullable=True),
        sa.Column("credentials", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("last_sync_at", sa.DateTime(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.CheckConstraint("store IN ('steam', 'epic', 'gog')", name="ck_account_store"),
        sa.CheckConstraint("status IN ('never', 'ok', 'error', 'reauth')", name="ck_account_status"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "store", "external_user_id", name="uq_account_user_store_ext"),
    )
    with op.batch_alter_table("library_accounts") as b:
        b.create_index("ix_library_accounts_user_id", ["user_id"], unique=False)

    op.create_table(
        "library_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("playtime_minutes", sa.Integer(), nullable=True),
        sa.Column("last_played_at", sa.DateTime(), nullable=True),
        sa.Column("cover_url", sa.String(length=1000), nullable=True),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("igdb_id", sa.Integer(), nullable=True),
        sa.Column("game_id", sa.Integer(), nullable=True),
        sa.Column("ignored", sa.Boolean(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["library_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "external_id", name="uq_item_account_ext"),
    )
    with op.batch_alter_table("library_items") as b:
        b.create_index("ix_library_items_account_id", ["account_id"], unique=False)
        b.create_index("ix_library_items_game_id", ["game_id"], unique=False)


def downgrade() -> None:
    op.drop_table("library_items")
    op.drop_table("library_accounts")
