"""configurações do servidor (chaves de API) e página pública por usuário

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-24 13:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=60), nullable=False),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    # Página pública ligada por padrão; cada usuário pode desligar.
    op.add_column("users", sa.Column("public_page", sa.Boolean(), nullable=False, server_default="1"))


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_column("public_page")
    op.drop_table("app_settings")
