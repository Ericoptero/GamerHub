# GamerHub

Backlog de jogos self-hosted que substitui a planilha. Tem biblioteca com listas, filtros por
aparelho, página de cada jogo com review, anotações e mídia, e integrações que trazem os dados
sozinhas:

- **IGDB** é a fonte principal: capa, descrição, história, screenshots, trailer, estúdio e tags
  (gêneros, temas, modos de jogo e perspectiva).
- **RAWG** é o fallback de metadados e também traz a nota do Metacritic e as tags da comunidade
  (Metroidvania, Souls-like, Atmospheric…).
- **HowLongToBeat**, por scraping, dá o tempo para zerar (main, main + extras, 100%).
- **Metacritic**, pelo backend JSON do site, dá o metascore **da sua plataforma**, a nota dos usuários e trechos de críticas.

O app inteiro roda em um container: FastAPI + SQLite servindo o frontend React.

## Subir com Docker

```bash
cp .env.example .env          # opcional: porta, fuso horário e login
mkdir -p data && sudo chown -R 1000:1000 data
docker compose up -d --build
```

Abra `http://<servidor>:8080`. Os dados ficam em `./data`:

- `gamerhub.db`: o banco.
- `media/`: capas e screenshots em cache.
- `backups/`: um backup automático por dia, mantendo os 7 últimos.

Use um disco local do servidor. Não aponte `./data` para um compartilhamento SMB/NFS, porque
o SQLite precisa de locks locais.

Por padrão o app **não tem login** (veja [Login e vários usuários](#login-e-vários-usuários-opcional)),
então deixe-o acessível só pela rede local ou por VPN (Tailscale, WireGuard). Se for expor, ligue
o login ou ponha um proxy reverso com autenticação na frente.

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

As chaves são cadastradas na tela **Configurações → Chaves de API**, que traz o passo a passo de
onde conseguir cada uma e um botão para testar. Valem para o servidor inteiro, então com o login
ligado só administradores veem essa parte. Trocar uma chave vale na hora, sem reiniciar.

| Integração | Precisa de chave? | Onde obter |
|---|---|---|
| IGDB | sim (grátis) | app na Twitch: <https://dev.twitch.tv/console/apps> (Client ID e Client Secret) |
| RAWG | sim (grátis) | <https://rawg.io/apidocs> |
| HowLongToBeat | não | — |
| Metacritic | não (hoje) | o campo só existe para o caso de o site passar a exigir |
| Steam (contas) | sim (grátis) | <https://steamcommunity.com/dev/apikey> (conta Steam com alguma compra) |
| Epic e GOG (contas) | não | login feito pela tela, veja abaixo |

As chaves ficam no banco (e, portanto, no `backup.sqlite` e nos backups diários; não entram no
`export.json`). Quem já tinha `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `RAWG_API_KEY`,
`METACRITIC_API_KEY` ou `STEAM_API_KEY` no `.env` não perde nada: no início, cada chave do `.env`
que o banco ainda não tem é copiada para ele uma vez. Depois disso pode tirar as linhas do `.env`.
Uma chave apagada pela tela não volta do `.env`.

### Contas Steam, Epic e GOG

Em **Integrações → Contas das lojas** você conecta quantas contas quiser, cada uma com um apelido.
O apelido aparece no card e na página de cada jogo.

- **Steam:** cole a URL do perfil, nos formatos `https://steamcommunity.com/id/JogadorExemplo/` ou
  `https://steamcommunity.com/profiles/76561198000000001/`. Para a lista vir, o perfil precisa
  deixar **"Detalhes do jogo"** como público (Steam → Perfil → Privacidade).
- **Epic:** clique em **Abrir login da Epic**. Com a conta logada, a página mostra um texto com
  `authorizationCode`; cole o texto inteiro (ou só o código). Ele vale poucos minutos.
- **GOG:** clique em **Abrir login da GOG**. Depois de entrar, o navegador para numa página em
  branco; copie a URL dela (tem `code=…`) e cole.

O que acontece com os jogos:

- **Biblioteca:** os jogos das contas entram no status **Biblioteca**, fora da lista de espera.
  É só mudar o status quando quiser jogar.
- **Mesmo jogo em várias contas:** vira **um jogo só**, com os selos de todas as contas. Ele é
  reconhecido pelo mesmo id na loja, pelo mesmo jogo no IGDB ou pelo mesmo nome, e jogos da
  planilha são reaproveitados.
- **Mesclar à mão:** nomes só parecidos ("Witcher 3" e "The Witcher 3 GOTY") viram uma sugestão
  na página do jogo, e também dá para mesclar qualquer jogo com outro.
- **Horas jogadas:** as horas da Steam e da Epic (somadas entre as contas) preenchem o campo
  enquanto você não digitar um valor. A GOG não informa horas.
- **Apagar:** um jogo apagado não volta na próxima sincronização. Na conta, "restaurar
  ignorados" traz de volta.
- **Checagem diária:** a partir das `LIBRARY_SYNC_HOUR` (padrão 5h, no fuso `TZ`), cada conta é
  checada uma vez por dia. Os jogos novos entram e os metadados deles (IGDB, RAWG, HLTB,
  Metacritic e capas) são baixados sozinhos. O botão **Sincronizar** faz isso na hora.
- **Tokens:** Epic e GOG guardam um token de acesso que é renovado a cada checagem. Se o servidor
  ficar semanas desligado, a conta pede para reconectar. Os tokens ficam no banco, ou seja, também
  no `backup.sqlite` e nos backups diários; não entram no `export.json`.

### Enriquecer a biblioteca

Em **Integrações → Enriquecer**, escolha o escopo:

- **sem dados:** jogos nunca enriquecidos.
- **desatualizados:** jogos com dados de mais de 30 dias.
- **todos.**

A primeira passada nos 240 jogos leva de 10 a 15 minutos. O Metacritic é consultado devagar de
propósito, e as passadas seguintes usam cache. O progresso aparece na tela, e se o container
reiniciar no meio, o job continua de onde parou.

Cada jogo é casado com o item de cada integração por nome, plataforma e ano. Quando uma integração
fica em dúvida (dois "Tomb Raider", por exemplo), não acha nada ou dá erro, o jogo aparece em
**Precisa da sua ajuda**, num card só com todas as integrações dele. Ali você:

- escolhe o resultado certo;
- procura por outro nome em cada integração (ex.: o título em inglês);
- corrige nome, plataforma ou lançamento e busca de novo ("Mais campos…" abre o editor completo);
- ou ignora aquela integração para o jogo.

Na página do jogo, **Atualizar pela integração** refaz só aquele jogo.

O enriquecimento respeita estas regras:

- Nunca mexe nos seus dados: status, nota, review, tempo jogado, datas, gênero e lojas.
- Valores que você editou à mão (HLTB, Metacritic, descrição, capa) ficam **travados** (cadeado)
  e não são sobrescritos. O cadeado pode ser aberto na página do jogo.
- Resultado vazio de uma integração não apaga o que já existe.

### Tags

Cada jogo junta as tags do IGDB (gêneros, temas, modos de jogo como "Co-operative" e perspectiva
como "First person") com até 12 tags da comunidade da RAWG, sem o ruído de loja (conquistas,
nuvem, suporte a controle). A mesma tag com grafias diferentes entra uma vez só ("Single player" e
"Singleplayer"). Elas ficam em inglês, como vêm das fontes.

As tags aparecem em **Informações**, na página do jogo; clicar numa abre a biblioteca filtrada por
ela, e o filtro também fica em **Filtros → Sobre o jogo**. Em **Editar** dá para tirar e pôr tags; a
partir daí a integração não mexe mais nelas até você destravar. Para trazer as tags novas para uma
biblioteca já enriquecida, rode **Buscar dados → Todos** marcando "Ignorar o cache".

### Backup e exportação

Em **Integrações → Exportar** estão:

- `export.json`: o backup completo, reimportável no modo "substituir".
- `export.csv`: no formato da planilha (`;`, abre direto no Excel).
- `backup.sqlite`: cópia do banco.

Para restaurar um `backup.sqlite`, pare o container, substitua `data/gamerhub.db` e suba de novo.

### Login e vários usuários (opcional)

Por padrão o app é de uma pessoa só e abre direto, sem login. Para ligar o login, coloque no `.env`:

```env
AUTH_ENABLED=true
AUTH_ALLOW_SIGNUP=true   # false fecha o cadastro; aí só um administrador cria contas
```

- **Primeiro acesso:** a primeira conta criada vira administradora e fica com a biblioteca que já existia.
- **Biblioteca de cada um:** jogos, notas, comentários, aparelhos e contas de loja são de cada usuário.
  Plataformas, gêneros e etiquetas de loja são compartilhados.
- **Administrador:** em **Usuários** (menu da conta), cria contas, redefine senhas, dá ou tira admin
  e remove usuários junto com a biblioteca deles.
- **Desligar de novo:** com `AUTH_ENABLED=false`, o app volta a abrir direto com a biblioteca da
  primeira conta.
- **Sessão:** o cookie dura `AUTH_SESSION_DAYS` (30 dias) e renova com o uso. Se servir por HTTPS,
  ligue `AUTH_COOKIE_SECURE=true`.
- **`backup.sqlite`:** com o login ligado, só administradores baixam. Ele contém os dados de todos,
  os hashes de senha, os tokens das lojas e as chaves de API.

### Página pública

Cada usuário tem uma página só de leitura em `http://<servidor>/<usuario>` (ex.: `/bruno`), aberta
para qualquer um, mesmo com o login ligado. Ela mostra os cards dos jogos (capa, status,
plataforma, nota, Metacritic, horas e tags) com abas por lista, busca e filtro por tag. Jogos
ocultos nunca aparecem, e comentários, contas de loja e aparelhos ficam de fora.

Em **Configurações** cada um troca o nome de usuário (que é o endereço da página), o nome de
exibição e liga ou desliga a página. Ela vem ligada; desligada, o endereço responde "página não
encontrada". Nomes que já são caminhos do app (`biblioteca`, `jogos`, `api`…) não podem ser
usados. Com o login desligado, o único usuário se chama `principal` até você trocar.

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
