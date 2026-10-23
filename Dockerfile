# syntax=docker/dockerfile:1.7

# ---------- frontend ----------
FROM node:24-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- backend + estáticos ----------
FROM python:3.13-slim AS app
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    STATIC_DIR=/app/static \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
COPY --from=web /web/dist ./static

RUN useradd --uid 1000 --create-home app && mkdir -p /data && chown app:app /data
USER app

EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

# Um worker só: a fila de enriquecimento roda dentro do processo e o banco é SQLite.
# As migrações rodam no startup do app.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
