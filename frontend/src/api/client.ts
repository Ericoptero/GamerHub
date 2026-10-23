export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

function detailMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: ValidationIssue) => {
        const field = (d.loc ?? []).filter((p) => p !== "body").join(".");
        return field ? `${field}: ${d.msg ?? "inválido"}` : (d.msg ?? "inválido");
      })
      .join("; ");
  }
  return fallback;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: "application/json" } };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor do GamerHub.");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = data && typeof data === "object" ? (data as { detail?: unknown }).detail : data;
    throw new ApiError(response.status, detailMessage(detail, `Erro ${response.status}`));
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  del: <T = void>(url: string) => request<T>("DELETE", url),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
