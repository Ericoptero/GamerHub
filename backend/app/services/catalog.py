"""Get-or-create e buscas tolerantes nos catálogos (plataformas, gêneros, lojas)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import fold
from app.models import Genre, Platform, Store


class CatalogCache:
    """Índices em memória para importações em lote (evita uma consulta por linha)."""

    def __init__(self, db: Session):
        self.db = db
        self.platforms = {fold(p.name): p for p in db.scalars(select(Platform))}
        self.genres = {fold(g.name): g for g in db.scalars(select(Genre))}
        self.stores = {fold(s.name): s for s in db.scalars(select(Store))}

    def platform(self, name: str | None) -> Platform:
        name = (name or "").strip() or "Outro"
        key = fold(name)
        if key not in self.platforms:
            p = Platform(name=name, sort_order=len(self.platforms))
            self.db.add(p)
            self.db.flush()
            self.platforms[key] = p
        return self.platforms[key]

    def genre(self, name: str | None) -> tuple[Genre | None, bool]:
        """Retorna (gênero, criado_agora)."""
        name = (name or "").strip()
        if not name:
            return None, False
        key = fold(name)
        if key in self.genres:
            return self.genres[key], False
        g = Genre(name=name, sort_order=len(self.genres))
        self.db.add(g)
        self.db.flush()
        self.genres[key] = g
        return g, True

    def store(self, name: str) -> Store:
        key = fold(name)
        if key not in self.stores:
            s = Store(name=name.strip())
            self.db.add(s)
            self.db.flush()
            self.stores[key] = s
        return self.stores[key]

    def stores_from(self, names: list[str]) -> list[Store]:
        seen: dict[str, Store] = {}
        for n in names:
            n = n.strip()
            if n and fold(n) not in seen:
                seen[fold(n)] = self.store(n)
        return list(seen.values())


def split_stores(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for part in str(raw).replace(";", ",").replace("/", ",").split(","):
        part = part.strip()
        if part and fold(part) not in {fold(o) for o in out}:
            out.append(part)
    return out
