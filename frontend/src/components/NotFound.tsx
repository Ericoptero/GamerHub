import { Link } from "react-router";

export function NotFound({ message = "Essa página não existe." }: { message?: string }) {
  return (
    <main className="page page-narrow">
      <div className="page-head">
        <h1 className="page-title">Não encontrado</h1>
        <p className="lead">{message}</p>
      </div>
      <Link to="/biblioteca" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
        Voltar para a biblioteca
      </Link>
    </main>
  );
}

export function LoadingState({ text = "Carregando…" }: { text?: string }) {
  return (
    <p className="muted" style={{ margin: "40px 24px" }} role="status">
      {text}
    </p>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="page page-narrow">
      <div className="card" role="alert">
        <h2 className="section-title">Algo deu errado</h2>
        <p className="error-text">{msg}</p>
        {onRetry && (
          <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={onRetry}>
            Tentar de novo
          </button>
        )}
      </div>
    </div>
  );
}
