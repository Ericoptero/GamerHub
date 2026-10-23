# GamerHub

Backlog de jogos self-hosted que substitui a planilha. Tem biblioteca com listas, filtros por
aparelho, página de cada jogo com review, anotações e mídia, e integrações que trazem os dados
sozinhas:

- **IGDB** é a fonte principal: capa, descrição, história, screenshots, trailer, gêneros e estúdio.
- **RAWG** é o fallback de metadados e também traz a nota do Metacritic.
- **HowLongToBeat**, por scraping, dá o tempo para zerar (main, main + extras, 100%).
- **Metacritic**, pelo backend JSON do site, dá o metascore **da sua plataforma**, a nota dos usuários e trechos de críticas.

O app inteiro roda em um container: FastAPI + SQLite servindo o frontend React.

## Subir com Docker

```bash
cp .env.example .env          # e preencha as chaves (opcional, veja abaixo)
mkdir -p data && sudo chown -R 1000:1000 data
docker compose up -d --build
```

Abra `http://<servidor>:8080`. Os dados ficam em `./data`:

- `gamerhub.db`: o banco.
- `media/`: capas e screenshots em cache.
- `backups/`: um backup automático por dia, mantendo os 7 últimos.

Use um disco local do servidor. Não aponte `./data` para um compartilhamento SMB/NFS, porque
o SQLite precisa de locks locais.

O app **não tem login**, então deixe-o acessível só pela rede local ou por VPN (Tailscale,
WireGuard). Se for expor, ponha um proxy reverso com autenticação na frente.

### Importar a planilha

A planilha original já está convertida em `backend/app/seed/planilha.json` (240 jogos). Há
duas formas de importar:

- **Pela interface:** em **Integrações → Importar → JSON**, envie o arquivo no modo "novos".
- **Pelo terminal:**

  ```bash
  docker compose exec gamerhub python -m app.cli import-json app/seed/planilha.json
  ```

Para reimportar a planilha depois (.xlsx ou .csv), use o assistente em **Integrações →
Importar planilha**. Ele mostra uma prévia, sugere o mapeamento das colunas, deduz o status pelo
nome da aba ("Lista de espera", "Finalizados"…) e simula antes de gravar. Os modos são:

- **novos:** ignora o que já existe.
- **atualizar:** sobrescreve os campos que vierem na planilha e acompanha mudança de status.
- **substituir:** apaga tudo e importa de novo, fazendo um backup antes.

### Chaves das integrações

| Integração | Precisa de chave? | Como obter |
|---|---|---|
| IGDB | sim (grátis) | Crie um app em <https://dev.twitch.tv/console/apps> (OAuth Redirect `http://localhost`, categoria "Application Integration") e copie **Client ID** e **Client Secret** para `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` |
| RAWG | sim (grátis) | <https://rawg.io/apidocs> → `RAWG_API_KEY` |
| HowLongToBeat | não | — |
| Metacritic | não (hoje) | `METACRITIC_API_KEY` só se o site passar a exigir |

Depois de editar o `.env`, rode `docker compose up -d` para recriar o container.

### Enriquecer a biblioteca

Em **Integrações → Enriquecer**, escolha o escopo:

- **sem dados:** jogos nunca enriquecidos.
- **desatualizados:** jogos com dados de mais de 30 dias.
- **todos.**

A primeira passada nos 240 jogos leva de 10 a 15 minutos. O Metacritic é consultado devagar de
propósito, e as passadas seguintes usam cache. O progresso aparece na tela, e se o container
reiniciar no meio, o job continua de onde parou.

Cada jogo é casado com o item de cada integração por nome, plataforma e ano. Quando há dúvida
(dois "Tomb Raider", por exemplo), o jogo vai para **Pendências**: você confirma o certo ou manda
ignorar aquela integração para o jogo. Na página do jogo, **Atualizar pela integração** refaz só
aquele jogo.

O enriquecimento respeita estas regras:

- Nunca mexe nos seus dados: status, nota, review, tempo jogado, datas, gênero e lojas.
- Valores que você editou à mão (HLTB, Metacritic, descrição, capa) ficam **travados** (cadeado)
  e não são sobrescritos. O cadeado pode ser aberto na página do jogo.
- Resultado vazio de uma integração não apaga o que já existe.

### Backup e exportação

Em **Integrações → Exportar** estão:

- `export.json`: o backup completo, reimportável no modo "substituir".
- `export.csv`: no formato da planilha (`;`, abre direto no Excel).
- `backup.sqlite`: cópia do banco.

Para restaurar um `backup.sqlite`, pare o container, substitua `data/gamerhub.db` e suba de novo.

## Desenvolvimento

Requisitos: Python 3.12+ com [uv](https://docs.astral.sh/uv/) e Node 22.22+ (ou 24).

```bash
# backend (http://127.0.0.1:8000, usa ./data na raiz do repositório)
cd backend
uv sync
uv run uvicorn app.main:app --reload

# frontend (http://localhost:5173, com proxy de /api e /media para o backend)
cd frontend
npm install
npm run dev
```

O dia a dia no backend gira em torno destes comandos:

```bash
uv run pytest                    # suíte completa, sem rede
uv run pytest -m live            # bate em HLTB/Metacritic (e IGDB/RAWG se houver chaves) de verdade
uv run python -m app.cli --help  # import-json, enrich, backup, gc-media, record-fixtures
uv run alembic revision --autogenerate -m "..."   # nova migração depois de mudar os modelos
```

No frontend: `npm test` (vitest), `npm run typecheck` e `npm run build`.

### Quando uma integração quebrar

HLTB e Metacritic não têm API oficial e mudam de tempos em tempos. Quando acontecer:

1. Rode `uv run pytest -m live` para ver qual quebrou.
2. **HLTB:** atualize a biblioteca (`uv lock --upgrade-package howlongtobeatpy`) e reconstrua a imagem.
3. **Metacritic:** o provider (`backend/app/integrations/metacritic.py`) tenta o backend JSON,
   depois o JSON-LD da página e, por fim, a nota que a RAWG conhece. Ajuste os endpoints ali.

Enquanto isso o app continua funcionando, e dá para editar HLTB e Metacritic à mão.

## Estrutura

```
backend/app/
  api/            rotas REST (games, catalog, integrations, io)
  models/         SQLAlchemy (games, platforms, devices, links, jobs, cache…)
  services/       importação (JSON/planilha), exportação, backup, cache de imagens
  integrations/   igdb, rawg, hltb, metacritic + matching (rapidfuzz), cache e HTTP com rate limit
  enrichment/     orquestrador (merge) e fila de jobs asyncio persistida
frontend/src/     React + TanStack Query; features/ espelha as telas do protótipo
docs/prototype/   protótipo de design original (especificação visual)
```
