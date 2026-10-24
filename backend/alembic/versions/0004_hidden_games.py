"""jogos ocultos (fora das listas, só na aba "Ocultos")

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-23 23:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADD COLUMN simples (sem recriar a tabela): os jogos existentes ficam visíveis.
    op.add_column("games", sa.Column("hidden", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("games") as b:
        b.drop_column("hidden")
