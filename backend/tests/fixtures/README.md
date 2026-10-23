# Fixtures

- `metacritic/`: respostas reais de `backend.metacritic.com` (out/2026), recortadas.
- `igdb/` e `rawg/`: montadas à mão seguindo o formato documentado das APIs (o projeto
  não tem chaves no CI). Para gravar respostas reais use `python -m app.cli record-fixtures`
  com as chaves no `.env`.
