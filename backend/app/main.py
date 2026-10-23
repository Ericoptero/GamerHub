import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from app import db as dbmod
from app.api import auth, catalog, games, integrations, io, users
from app.auth.sessions import COOKIE, resolve_token
from app.config import get_settings
from app.enrichment.jobs import worker
from app.integrations.cache import purge_expired
from app.integrations.registry import close_all
from app.migrate import migrate
from app.seed.seed_data import seed_catalogs
from app.services.backup import daily_backup_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("gamerhub")


class CachedStaticFiles(StaticFiles):
    """Arquivos com nome derivado do conteúdo nunca mudam: cache de 1 ano."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    settings.ensure_dirs()
    dbmod.configure(settings.database_url)
    migrate()
    with dbmod.new_session() as db:
        if seed_catalogs(db):
            log.info("catálogos iniciais criados (gêneros, plataformas, aparelhos)")
    await asyncio.to_thread(purge_expired)
    background: list[asyncio.Task] = []
    if settings.worker_enabled:
        worker.start()
        background.append(asyncio.create_task(daily_backup_loop(), name="daily-backup"))
    try:
        yield
    finally:
        for task in background:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        await worker.stop()
        await close_all()


PUBLIC_API = ("/api/auth/", "/api/health")
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
APP_HEADER = "x-gamerhub"


def install_auth_guard(app: FastAPI) -> None:
    """Com o login ligado: resolve a sessão do cookie e barra /api e /media sem login.

    Mutações exigem o cabeçalho X-GamerHub (o frontend sempre manda). Um formulário de outro
    site não consegue mandar cabeçalho próprio, então isso, junto do cookie SameSite=Lax, barra CSRF.
    """

    @app.middleware("http")
    async def auth_guard(request: Request, call_next):
        path = request.url.path
        is_api = path.startswith("/api/")
        if is_api and request.method in UNSAFE_METHODS and request.headers.get(APP_HEADER) != "1":
            return JSONResponse({"detail": "Requisição sem o cabeçalho do GamerHub"}, status_code=403)
        token = request.cookies.get(COOKIE)
        request.state.user_id = await run_in_threadpool(resolve_token, token) if token else None
        protected = (is_api and not path.startswith(PUBLIC_API)) or path.startswith("/media/")
        if protected and request.state.user_id is None:
            return JSONResponse({"detail": "Faça login para continuar"}, status_code=401)
        return await call_next(request)


def create_app() -> FastAPI:
    settings = get_settings()
    settings.ensure_dirs()
    app = FastAPI(title="GamerHub", version="0.1.0", lifespan=lifespan)
    if settings.auth_enabled:
        install_auth_guard(app)
    for router in (auth.router, users.router, catalog.router, games.router, integrations.router, io.router):
        app.include_router(router)
    app.mount("/media", CachedStaticFiles(directory=settings.media_dir, check_dir=False), name="media")

    static_dir: Path = settings.static_dir
    index = static_dir / "index.html"
    if (static_dir / "assets").is_dir():
        app.mount("/assets", CachedStaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith(("api/", "media/")):
            raise HTTPException(404)
        candidate = (static_dir / path).resolve()
        if path and candidate.is_file() and static_dir.resolve() in candidate.parents:
            return FileResponse(candidate)
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return HTMLResponse(
            "<h1>GamerHub</h1><p>Frontend não compilado. Em desenvolvimento use <code>npm run dev</code> "
            "em <code>frontend/</code> e abra <a href='http://localhost:5173'>localhost:5173</a>.</p>"
        )

    return app


app = create_app()
