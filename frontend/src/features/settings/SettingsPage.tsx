import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "react-router";

import { errorMessage } from "../../api/client";
import { useApiKeys, useMe, useSaveApiKeys, useTestApiKey, useUpdateProfile } from "../../api/queries";
import type { ApiKeyName, ApiKeys, ApiKeysPatch, KeyTestProvider, KeyTestResult, User } from "../../api/types";
import { useConfirm } from "../../components/Confirm";
import { Icon } from "../../components/Icon";
import { ErrorState } from "../../components/NotFound";
import { useToast } from "../../components/Toast";
import { copyText } from "../../lib/clipboard";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const me = useMe();
  const { hash } = useLocation();
  const authEnabled = me.data?.auth_enabled ?? false;
  const user = me.data?.user ?? null;
  // Com o login desligado todo mundo é o usuário principal, que é admin.
  const canManageKeys = !authEnabled || !!user?.is_admin;
  const apiKeys = useApiKeys(canManageKeys);
  const keysReady = !canManageKeys || !apiKeys.isPending;

  // /configuracoes#chaves (link das Integrações): rola até a seção depois que ela aparece.
  useEffect(() => {
    if (hash && keysReady) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash, keysReady]);

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <h1 className="page-title">Configurações</h1>
        <p className="lead">Seu perfil, a página pública com a sua lista de jogos e as chaves das integrações.</p>
      </div>
      {user && <ProfileCard user={user} authEnabled={authEnabled} />}
      <section id="chaves" aria-labelledby="h-keys" className={`card ${styles.anchor}`}>
        <h2 id="h-keys" className="section-title">
          Chaves de API
        </h2>
        {!canManageKeys ? (
          <p className="lead">
            As chaves valem para o servidor inteiro, então só um administrador pode cadastrar. Peça para ele se alguma
            integração aparecer como “sem chave”.
          </p>
        ) : apiKeys.isError ? (
          <ErrorState error={apiKeys.error} onRetry={() => apiKeys.refetch()} />
        ) : !apiKeys.data ? (
          <p className="muted">Carregando…</p>
        ) : (
          <>
            <p className="lead">
              Valem para todos os usuários deste GamerHub e ficam guardadas no banco do servidor (entram no backup). Depois
              de salvar, a chave nunca mais aparece inteira aqui: só os últimos caracteres, para você reconhecer.
            </p>
            <div className={styles.sources}>
              {SOURCES.map((s) => (
                <KeySource key={s.id} source={s} saved={apiKeys.data} />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

// ---------- perfil e página pública ----------

function ProfileCard({ user, authEnabled }: { user: User; authEnabled: boolean }) {
  const update = useUpdateProfile();
  const publish = useUpdateProfile();
  const toast = useToast();
  // A chave muda na hora; volta se o servidor recusar.
  const [publicOn, setPublicOn] = useState(user.public_page);
  const [username, setUsername] = useState(user.username);
  const [display, setDisplay] = useState(user.display_name);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/${encodeURIComponent(user.username)}`;
  const dirty = username.trim() !== user.username || display.trim() !== user.display_name;

  const save = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(
      { username: username.trim(), display_name: display.trim() || username.trim() },
      {
        onSuccess: (saved) => {
          setUsername(saved.username);
          setDisplay(saved.display_name);
          toast.show(
            saved.username !== user.username ? `Pronto: sua página agora é /${saved.username}.` : "Perfil salvo.",
            "ok",
          );
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  const togglePublic = (on: boolean) => {
    setPublicOn(on);
    publish.mutate(
      { public_page: on },
      {
        onSuccess: () =>
          toast.show(on ? "Página pública ligada." : "Página pública desligada: o endereço responde “não encontrada”.", "ok"),
        onError: (err) => {
          setPublicOn(!on);
          toast.error(errorMessage(err));
        },
      },
    );
  };

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Não consegui copiar. Selecione o endereço e copie à mão.");
    }
  };

  return (
    <section aria-labelledby="h-profile" className="card">
      <h2 id="h-profile" className="section-title">
        Perfil e página pública
      </h2>
      <form onSubmit={save} className={styles.form}>
        <div className="field-grid">
          <label className="field">
            Nome de usuário
            <input
              className="input"
              required
              minLength={3}
              maxLength={40}
              pattern="[\w.\-]+"
              title="Letras, números, ponto, hífen e sublinhado (sem espaços)"
              autoComplete="username"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            Nome de exibição
            <input
              className="input"
              maxLength={80}
              autoComplete="nickname"
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
            />
          </label>
        </div>
        <p className={styles.hint}>
          O nome de usuário vira o endereço da sua página
          {authEnabled ? " e também é o que você digita para entrar" : ""}. O nome de exibição aparece no topo dela.
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row-end">
          <button type="submit" className="btn btn-primary" disabled={!dirty || update.isPending}>
            Salvar perfil
          </button>
        </div>
      </form>

      <div className={styles.public}>
        <label className="check">
          <input
            type="checkbox"
            checked={publicOn}
            disabled={publish.isPending}
            onChange={(e) => togglePublic(e.target.checked)}
          />
          <strong>Página pública ligada</strong>
        </label>
        <p className="lead">
          Qualquer pessoa com o endereço vê os cards dos seus jogos: capa, status, plataforma, nota, Metacritic, horas e
          tags. Jogos ocultos nunca aparecem; comentários, contas de loja e aparelhos ficam só com você.
        </p>
        <div className={styles.linkRow} data-off={!publicOn || undefined}>
          <code className={styles.url}>{url}</code>
          <div className="row">
            <a
              className="btn btn-sm"
              href={`/${encodeURIComponent(user.username)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="external" size={14} /> Abrir
            </a>
            <button type="button" className="btn btn-sm" onClick={copy}>
              <Icon name={copied ? "check" : "link"} size={14} /> {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
        {!publicOn && <p className={styles.hint}>Desligada: quem abrir esse endereço vê “página não encontrada”.</p>}
      </div>
    </section>
  );
}

// ---------- chaves ----------

interface Source {
  id: "igdb" | "rawg" | "steam" | "metacritic";
  title: string;
  unlocks: string;
  fields: { key: ApiKeyName; label: string }[];
  test?: KeyTestProvider;
  /** Funciona sem chave (o Metacritic, hoje). */
  optional?: boolean;
  steps: ReactNode[];
  note?: ReactNode;
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const SOURCES: Source[] = [
  {
    id: "igdb",
    title: "IGDB",
    unlocks:
      "Fonte principal: capa, descrição, história, screenshots, trailer, tempo de jogo e tags (gênero, tema, modo e perspectiva). O IGDB é da Twitch, por isso a chave sai de lá.",
    fields: [
      { key: "igdb_client_id", label: "Client ID (ID do cliente)" },
      { key: "igdb_client_secret", label: "Client Secret (segredo do cliente)" },
    ],
    test: "igdb",
    steps: [
      <>
        Entre em <Ext href="https://dev.twitch.tv/console/apps">dev.twitch.tv/console/apps</Ext> com sua conta da Twitch
        (crie uma se não tiver). A Twitch exige a verificação em duas etapas ligada na conta para registrar aplicativos.
      </>,
      <>
        Clique em <b>Registrar seu aplicativo</b> (Register Your Application) e preencha: <b>Nome</b>: qualquer um que
        ainda não exista na Twitch, como “GamerHub de {"<"}seu nome{">"}”; <b>URLs de redirecionamento OAuth</b>:{" "}
        <code>http://localhost</code>; <b>Categoria</b>: Application Integration; <b>Tipo de cliente</b>: Confidencial.
      </>,
      <>
        Volte à lista de aplicativos, clique em <b>Gerenciar</b> no que você criou e copie o <b>ID do cliente</b> para o
        primeiro campo abaixo.
      </>,
      <>
        Na mesma página, clique em <b>Novo segredo</b> e copie o <b>Segredo do cliente</b> para o segundo campo. Ele só
        aparece uma vez: se perder, gere outro e cole aqui de novo.
      </>,
    ],
    note: (
      <>
        Documentação oficial: <Ext href="https://api-docs.igdb.com/#account-creation">api-docs.igdb.com</Ext>. É grátis.
      </>
    ),
  },
  {
    id: "rawg",
    title: "RAWG",
    unlocks:
      "Reserva quando o IGDB não acha o jogo, nota do Metacritic e as tags da comunidade (Metroidvania, Souls-like, Atmospheric…).",
    fields: [{ key: "rawg_api_key", label: "API key" }],
    test: "rawg",
    steps: [
      <>
        Crie uma conta grátis em <Ext href="https://rawg.io/signup">rawg.io</Ext> (ou entre com a sua).
      </>,
      <>
        Abra <Ext href="https://rawg.io/apidocs">rawg.io/apidocs</Ext> e clique em <b>Get API Key</b>. No formulário,
        descreva o uso como pessoal (por exemplo, “biblioteca de jogos pessoal”); no site, pode pôr{" "}
        <code>http://localhost</code>.
      </>,
      <>
        A chave aparece em seguida e fica guardada no seu perfil da RAWG, em <b>API key</b>. Copie e cole abaixo.
      </>,
    ],
    note: <>O plano grátis dá 20 mil requisições por mês, de sobra para uso pessoal.</>,
  },
  {
    id: "steam",
    title: "Steam",
    unlocks: "Conectar contas Steam pela URL do perfil: importa os jogos da conta e as horas jogadas, todo dia.",
    fields: [{ key: "steam_api_key", label: "Chave da Steam Web API" }],
    test: "steam",
    steps: [
      <>
        Entre em <Ext href="https://steamcommunity.com/dev/apikey">steamcommunity.com/dev/apikey</Ext> com sua conta
        Steam. Contas limitadas (que nunca gastaram US$ 5 na loja) não conseguem gerar a chave.
      </>,
      <>
        Em <b>Nome de domínio</b>, escreva qualquer coisa, como <code>localhost</code>, aceite os termos e clique em{" "}
        <b>Registrar</b>. A Steam pode pedir confirmação no Steam Guard do celular.
      </>,
      <>
        Copie a <b>Chave</b> que aparece na página e cole abaixo.
      </>,
    ],
    note: (
      <>
        Para importar a biblioteca, o perfil e os <b>detalhes do jogo</b> precisam estar públicos na Steam (Editar
        perfil → Configurações de privacidade). Epic e GOG não precisam de chave: a conta entra pela tela de
        Integrações.
      </>
    ),
  },
  {
    id: "metacritic",
    title: "Metacritic",
    unlocks: "Metascore, nota dos usuários e críticas.",
    fields: [{ key: "metacritic_api_key", label: "Chave (opcional)" }],
    optional: true,
    steps: [
      <>Hoje o Metacritic não pede chave: as notas e críticas já funcionam sem nada aqui.</>,
      <>
        O campo só existe para o caso de o site passar a exigir uma. Se isso acontecer, cole a chave aqui (ela vai como o
        parâmetro <code>apiKey</code>).
      </>,
    ],
  },
];

function KeySource({ source, saved }: { source: Source; saved: ApiKeys }) {
  const save = useSaveApiKeys();
  const test = useTestApiKey();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [values, setValues] = useState<ApiKeysPatch>({});
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<KeyTestResult | null>(null);
  const configured = source.fields.every((f) => saved[f.key].configured);
  const anySaved = source.fields.some((f) => saved[f.key].configured);
  const typed: ApiKeysPatch = Object.fromEntries(
    source.fields.map((f) => [f.key, (values[f.key] ?? "").trim()]).filter(([, v]) => v),
  );
  const hasTyped = Object.keys(typed).length > 0;
  const busy = save.isPending || test.isPending;

  const runTest = () => {
    if (!source.test) return;
    test.mutate(source.test, {
      onSuccess: setResult,
      onError: (err) => setResult({ ok: false, message: errorMessage(err) }),
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    if (!hasTyped) return runTest();
    save.mutate(typed, {
      onSuccess: () => {
        setValues({});
        if (source.test) runTest();
        else setResult({ ok: true, message: "Chave salva." });
      },
      onError: (err) => setResult({ ok: false, message: errorMessage(err) }),
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Apagar a chave ${source.title}?`,
      message: source.optional
        ? "O Metacritic continua funcionando sem chave enquanto o site não exigir uma."
        : `As buscas e atualizações que dependem do ${source.title} param até você cadastrar outra chave.`,
      confirmLabel: "Apagar",
      danger: true,
    });
    if (!ok) return;
    setResult(null);
    save.mutate(Object.fromEntries(source.fields.map((f) => [f.key, ""])), {
      onSuccess: () => toast.show(`Chave ${source.title} apagada.`, "ok"),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const badge = configured
    ? { cls: styles.on, label: "Cadastrada" }
    : source.optional
      ? { cls: styles.neutral, label: "Não precisa" }
      : anySaved
        ? { cls: styles.off, label: "Incompleta" }
        : { cls: styles.off, label: "Sem chave" };

  return (
    <article className={styles.source} aria-labelledby={`h-key-${source.id}`}>
      <header className={styles.sourceHead}>
        <h3 id={`h-key-${source.id}`} className={styles.sourceName}>
          {source.title}
        </h3>
        <span className={badge.cls}>{badge.label}</span>
      </header>
      <p className={styles.unlocks}>{source.unlocks}</p>
      <details className={styles.howto} open={!anySaved && !source.optional}>
        <summary>{source.optional ? "Preciso de chave?" : "Como conseguir a chave"}</summary>
        <ol>
          {source.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {source.note && <p className={styles.note}>{source.note}</p>}
      </details>
      <form onSubmit={submit} className={styles.keyForm}>
        {source.fields.map((f) => (
          <label key={f.key} className="field">
            {f.label}
            <input
              className="input"
              type={show ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              placeholder={saved[f.key].configured ? `Salva (${saved[f.key].preview}). Cole outra para trocar` : "Cole aqui"}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-pressed={show}
            onClick={() => setShow((s) => !s)}
          >
            <Icon name={show ? "eyeOff" : "eye"} size={14} /> {show ? "Esconder" : "Mostrar"}
          </button>
          <span className={styles.spacer} />
          {anySaved && (
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={remove}>
              <Icon name="trash" size={14} /> Apagar
            </button>
          )}
          <button
            type="submit"
            className="btn btn-sm btn-primary"
            disabled={busy || (!hasTyped && !(configured && source.test))}
          >
            {hasTyped || !configured ? (source.test ? "Salvar e testar" : "Salvar") : "Testar"}
          </button>
        </div>
        <p className={result?.ok ? styles.ok : "error-text"} role="status" aria-live="polite">
          {busy ? (
            <span className="muted">{save.isPending ? "Salvando…" : "Testando a chave…"}</span>
          ) : result ? (
            <>
              {result.ok && <Icon name="check" size={14} />} {result.message}
            </>
          ) : null}
        </p>
      </form>
      {dialog}
    </article>
  );
}
