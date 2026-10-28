"""posse do jogo (tenho, aguardando lançamento, ainda não comprei, Game Pass)

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-27 18:00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADD COLUMN simples (sem recriar a tabela), com o CHECK na própria coluna.
    op.execute(
        "ALTER TABLE games ADD COLUMN access VARCHAR(12) NOT NULL DEFAULT 'owned' "
        "CONSTRAINT ck_games_access CHECK (access IN ('owned', 'unreleased', 'wishlist', 'gamepass'))"
    )
    # Hype quer dizer "ainda não saiu ou estou de olho para comprar": a data diz qual dos dois.
    op.execute(
        "UPDATE games SET access = CASE WHEN release_date IS NULL OR release_date > date('now') "
        "THEN 'unreleased' ELSE 'wishlist' END WHERE status = 'hype'"
    )


def downgrade() -> None:
    with op.batch_alter_table("games") as b:
        b.drop_column("access")
