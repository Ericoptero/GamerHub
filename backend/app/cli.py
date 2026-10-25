"""Linha de comando: `python -m app.cli --help` (no container: `docker compose exec gamerhub python -m app.cli`)."""

import asyncio
import json
from pathlib import Path

import typer

from app import db as dbmod
from app.config import get_settings
from app.domain import DEFAULT_USER_ID
from app.migrate import migrate
from app.seed.seed_data import seed_catalogs
from app.services import api_keys

cli = typer.Typer(help="Ferramentas do GamerHub", no_args_is_help=True)


def _setup() -> None:
    settings = get_settings()
    settings.ensure_dirs()
    dbmod.configure(settings.database_url)
    migrate()
    with dbmod.new_session() as db:
        seed_catalogs(db)
        api_keys.startup(db, settings)


@cli.command("import-json")
def import_json(
    path: Path,
    mode: str = typer.Option("novos", help="novos | atualizar | substituir"),
    user: int = typer.Option(DEFAULT_USER_ID, help="id do usuário dono dos jogos"),
):
    """Importa o JSON curto da planilha (n, p, g, st…) ou um export.json completo."""
    from app.services.exporter import restore_json
    from app.services.importer import import_short_json

    _setup()
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    with dbmod.new_session() as db:
        if isinstance(data, dict):
            typer.echo(restore_json(db, user, data))
            return
        report = import_short_json(db, user, data, mode)
    typer.echo(f"criados {report.created} · atualizados {report.updated} · ignorados {report.skipped}")
    for w in report.warnings:
        typer.echo(f"  aviso: {w}")


@cli.command()
def enrich(
    scope: str = typer.Option("missing", help="missing | stale | all"),
    provider: list[str] = typer.Option(None, help="igdb, rawg, hltb, metacritic (padrão: todos)"),
    force: bool = typer.Option(False, help="ignora o cache"),
    user: int = typer.Option(DEFAULT_USER_ID, help="id do usuário dono dos jogos"),
):
    """Enriquece os jogos agora, neste processo (o app não precisa estar rodando)."""
    from app.enrichment import jobs
    from app.integrations.registry import close_all
    from app.models import Job
    from app.schemas import EnrichIn

    _setup()
    with dbmod.new_session() as db:
        job = jobs.request_enrich(db, user, EnrichIn(scope=scope, providers=provider or None, force=force))  # type: ignore[arg-type]
        job_id, total = job.id, job.total
    typer.echo(f"job {job_id}: {total} jogo(s)")

    async def run() -> None:
        task = asyncio.create_task(jobs.run_job(job_id))
        seen = 0
        while not task.done():
            await asyncio.sleep(2)
            with dbmod.new_session() as db:
                j = db.get(Job, job_id)
                for line in (j.log or [])[seen - j.processed :] if j and j.processed > seen else []:
                    typer.echo(f"  {line}")
                seen = j.processed if j else seen
        await task
        await close_all()

    asyncio.run(run())
    typer.echo("pronto")


@cli.command()
def backup():
    """Gera um backup do banco em data/backups."""
    from app.services.backup import make_backup

    _setup()
    typer.echo(make_backup("manual"))


@cli.command("gc-media")
def gc_media():
    """Apaga imagens em cache que nenhum jogo usa mais."""
    from app.services.media_cache import collect_garbage

    _setup()
    typer.echo(f"{collect_garbage()} arquivo(s)/pasta(s) removidos")


@cli.command("record-fixtures")
def record_fixtures(
    game: str,
    out: Path = typer.Option(Path("tests/fixtures/recorded"), help="pasta de saída"),
):
    """Grava respostas reais de IGDB e RAWG para um jogo (precisa das chaves cadastradas)."""
    from app.integrations.registry import close_all, get_provider

    _setup()
    out.mkdir(parents=True, exist_ok=True)
    slug = "".join(c if c.isalnum() else "-" for c in game.lower()).strip("-")

    async def run() -> None:
        igdb = get_provider("igdb")
        if igdb.enabled:
            from app.integrations.igdb import DETAIL_FIELDS, SEARCH_FIELDS

            found = await igdb.query("games", f'search "{game}"; fields {SEARCH_FIELDS}; limit 10;')  # type: ignore[attr-defined]
            (out / f"igdb-search-{slug}.json").write_text(json.dumps(found, indent=1), encoding="utf-8")
            if found:
                detail = await igdb.query("games", f"fields {DETAIL_FIELDS}; where id = {found[0]['id']};")  # type: ignore[attr-defined]
                (out / f"igdb-game-{found[0]['id']}.json").write_text(json.dumps(detail, indent=1), encoding="utf-8")
        rawg = get_provider("rawg")
        if rawg.enabled:
            data = await rawg._get("/games", search=game, search_precise="true", page_size=5)  # type: ignore[attr-defined]
            (out / f"rawg-search-{slug}.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
        await close_all()

    asyncio.run(run())
    typer.echo(f"gravado em {out} (as respostas não contêm as chaves)")


if __name__ == "__main__":
    cli()
