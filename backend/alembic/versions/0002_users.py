"""usuários, sessões, dono de jogos/aparelhos/jobs, status "owned" e origem das horas jogadas

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-23 12:00:00

Tudo o que já existia passa a ser do usuário 1 (o implícito do modo sem login).
Escrita à mão: o autogenerate não enxerga mudança de CHECK, e a lista de status fica
fixa aqui (não importa app.domain, que muda com o tempo).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_STATUSES = "status IN ('backlog', 'playing', 'done', 'dropped', 'hype')"
NEW_STATUSES = "status IN ('backlog', 'playing', 'done', 'dropped', 'hype', 'owned')"
OWNED_TABLES = ("games", "devices", "jobs")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=40, collation="NOCASE"), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )
    op.execute("INSERT INTO users (id, username, display_name, is_admin) VALUES (1, 'principal', 'Principal', 1)")
    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    with op.batch_alter_table("sessions") as b:
        b.create_index("ix_sessions_user_id", ["user_id"], unique=False)

    # 1ª passada: a coluna nasce com DEFAULT 1 para preencher as linhas existentes.
    for table in OWNED_TABLES:
        with op.batch_alter_table(table) as b:
            b.add_column(sa.Column("user_id", sa.Integer(), nullable=False, server_default="1"))
            b.create_foreign_key(f"fk_{table}_user_id", "users", ["user_id"], ["id"], ondelete="CASCADE")
            b.create_index(f"ix_{table}_user_id", ["user_id"], unique=False)
            if table == "games":
                b.add_column(sa.Column("played_hours_source", sa.String(length=10), nullable=True))
                b.drop_constraint("ck_games_status", type_="check")
                b.create_check_constraint("ck_games_status", NEW_STATUSES)
    # 2ª passada: sem default, para que esquecer o dono vire erro em vez de cair no usuário 1.
    for table in OWNED_TABLES:
        with op.batch_alter_table(table) as b:
            b.alter_column("user_id", existing_type=sa.Integer(), existing_nullable=False, server_default=None)


def downgrade() -> None:
    for table in reversed(OWNED_TABLES):
        with op.batch_alter_table(table) as b:
            if table == "games":
                b.drop_constraint("ck_games_status", type_="check")
                b.create_check_constraint("ck_games_status", OLD_STATUSES)
                b.drop_column("played_hours_source")
            b.drop_index(f"ix_{table}_user_id")
            b.drop_constraint(f"fk_{table}_user_id", type_="foreignkey")
            b.drop_column("user_id")
    op.drop_table("sessions")
    op.drop_table("users")
