import json
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy.orm import Session

from app.auth.deps import current_user, require_admin
from app.db import get_db
from app.models import User
from app.services import sheet_import
from app.services.backup import backup_to
from app.services.exporter import export_csv, export_json, restore_json
from app.services.importer import IMPORT_MODES, ImportReport, import_short_json

router = APIRouter(prefix="/api", tags=["import-export"])

MAX_UPLOAD = 20 * 1024 * 1024


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Arquivo maior que 20 MB")
    return data


@router.post("/import/json")
async def import_json(
    file: UploadFile = File(...),
    mode: str = Query("novos"),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Aceita o JSON curto da planilha (lista de {n, p, g, st…}) ou um export.json completo."""
    if mode not in IMPORT_MODES:
        raise HTTPException(422, f"modo deve ser um de {IMPORT_MODES}")
    try:
        payload = json.loads((await _read_upload(file)).decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HTTPException(422, f"JSON inválido: {e}") from None
    if isinstance(payload, dict) and "version" in payload:
        if mode != "substituir":
            raise HTTPException(422, "Um export.json completo só pode ser importado no modo 'substituir'")
        try:
            restored = restore_json(db, user.id, payload)
        except (ValueError, KeyError) as e:
            raise HTTPException(422, f"Export inválido: {e}") from None
        return ImportReport(created=restored["games"])
    if not isinstance(payload, list):
        raise HTTPException(422, "Esperava uma lista de jogos ou um export.json")
    return import_short_json(db, user.id, payload, mode)


@router.post("/import/sheet/preview", response_model=sheet_import.SheetPreview)
async def sheet_preview(file: UploadFile = File(...), _user: User = Depends(current_user)):
    data = await _read_upload(file)
    try:
        return sheet_import.preview(file.filename or "planilha", data)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@router.post("/import/sheet/commit", response_model=ImportReport)
def sheet_commit(data: sheet_import.SheetCommit, db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        return sheet_import.commit(db, user.id, data)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(422, str(e)) from None


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M")


@router.get("/export.json")
def download_json(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return JSONResponse(
        export_json(db, user.id),
        headers={"Content-Disposition": f'attachment; filename="gamerhub-{_stamp()}.json"'},
    )


@router.get("/export.csv")
def download_csv(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return Response(
        export_csv(db, user.id).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="gamerhub-{_stamp()}.csv"'},
    )


@router.get("/backup.sqlite")
def download_backup(background: BackgroundTasks, _admin: User = Depends(require_admin)):
    """O banco inteiro: dados de todos os usuários, hashes de senha e tokens das lojas."""
    tmp = Path(tempfile.mkdtemp()) / f"gamerhub-{_stamp()}.db"
    backup_to(tmp)
    background.add_task(lambda: (tmp.unlink(missing_ok=True), tmp.parent.rmdir()))
    return FileResponse(tmp, filename=tmp.name, media_type="application/vnd.sqlite3")
