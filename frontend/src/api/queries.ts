import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { api, qs } from "./client";
import type {
  Account,
  AccountCreate,
  AccountPatch,
  ApiKeys,
  ApiKeysPatch,
  AuthMe,
  Candidate,
  Comment,
  Device,
  DeviceIn,
  DevicePatch,
  EnrichIn,
  GameCard,
  GameCreate,
  GameDetail,
  GameList,
  GameListCreate,
  GameListPatch,
  GamePatch,
  Genre,
  Job,
  KeyTestProvider,
  KeyTestResult,
  LoginIn,
  Meta,
  PendingGame,
  Platform,
  PlatformIn,
  PlatformPatch,
  ProfilePatch,
  ProviderName,
  PublicProfile,
  RefreshIn,
  SignupIn,
  Store,
  StoreName,
  User,
  UserAdmin,
  UserCreate,
  UserPatch,
} from "./types";

export const keys = {
  games: ["games"] as const,
  game: (id: number) => ["game", id] as const,
  devices: ["devices"] as const,
  platforms: ["platforms"] as const,
  genres: ["genres"] as const,
  stores: ["stores"] as const,
  meta: ["meta"] as const,
  job: (id: number) => ["job", id] as const,
  jobs: ["jobs"] as const,
  pending: ["pending"] as const,
  me: ["me"] as const,
  users: ["users"] as const,
  accounts: ["accounts"] as const,
  apiKeys: ["api-keys"] as const,
  publicProfile: (username: string) => ["public", username.toLowerCase()] as const,
  lists: ["lists"] as const,
};

// ---------- leitura ----------

export const useGames = () =>
  useQuery({ queryKey: keys.games, queryFn: () => api.get<GameCard[]>("/api/games"), staleTime: 30_000 });

export const useGame = (id: number, refetchInterval?: (game: GameDetail | undefined) => number | false) =>
  useQuery({
    queryKey: keys.game(id),
    queryFn: () => api.get<GameDetail>(`/api/games/${id}`),
    enabled: Number.isFinite(id),
    refetchInterval: refetchInterval ? (q) => refetchInterval(q.state.data) : undefined,
  });

export const useDevices = () =>
  useQuery({ queryKey: keys.devices, queryFn: () => api.get<Device[]>("/api/devices"), staleTime: 60_000 });

export const usePlatforms = () =>
  useQuery({ queryKey: keys.platforms, queryFn: () => api.get<Platform[]>("/api/platforms"), staleTime: 60_000 });

export const useGenres = () =>
  useQuery({ queryKey: keys.genres, queryFn: () => api.get<Genre[]>("/api/genres"), staleTime: 300_000 });

export const useStores = () =>
  useQuery({ queryKey: keys.stores, queryFn: () => api.get<Store[]>("/api/stores"), staleTime: 300_000 });

export const useMeta = () =>
  useQuery({ queryKey: keys.meta, queryFn: () => api.get<Meta>("/api/meta"), staleTime: 300_000 });

export const usePending = (provider?: string) =>
  useQuery({
    queryKey: [...keys.pending, provider ?? ""],
    queryFn: () => api.get<PendingGame[]>(`/api/integrations/pending${qs({ provider })}`),
  });

/** Os jobs mais recentes de um tipo (os vários "atualizar jogo" não empurram um lote para fora da lista). */
export const useJobs = (kind: "enrich" | "library_sync", refetchInterval?: number | false) =>
  useQuery({
    queryKey: [...keys.jobs, kind],
    queryFn: () => api.get<Job[]>(`/api/jobs${qs({ kind, limit: 10 })}`),
    refetchInterval,
  });

const ACTIVE_JOB = new Set(["queued", "running"]);

export const isJobActive = (job: Job | undefined | null) => !!job && ACTIVE_JOB.has(job.status);

/** Faz polling de um job a cada 1,5 s enquanto ele estiver na fila ou rodando. */
export const useJob = (id: number | null) =>
  useQuery({
    queryKey: keys.job(id ?? -1),
    queryFn: () => api.get<Job>(`/api/jobs/${id}`),
    enabled: id !== null,
    refetchInterval: (q) => (isJobActive(q.state.data) || !q.state.data ? 1500 : false),
  });

/** Busca avulsa numa integração. Com `gameId`, ranqueia pela plataforma e pelo ano daquele jogo. */
export const useExternalSearch = (provider: ProviderName, q: string, platformId: number | null, gameId?: number) =>
  useQuery({
    queryKey: ["ext-search", provider, q, platformId ?? 0, gameId ?? 0],
    queryFn: () =>
      api.get<Candidate[]>(
        `/api/integrations/search${qs({ provider, q, platform_id: platformId, game_id: gameId })}`,
      ),
    enabled: q.trim().length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

// ---------- escrita ----------

/** Aplica um patch otimista na lista e no detalhe; devolve uma função de rollback. */
function optimistic(qc: QueryClient, id: number, patch: Partial<GameDetail>) {
  const prevList = qc.getQueryData<GameCard[]>(keys.games);
  const prevGame = qc.getQueryData<GameDetail>(keys.game(id));
  if (prevList) qc.setQueryData<GameCard[]>(keys.games, prevList.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  if (prevGame) qc.setQueryData<GameDetail>(keys.game(id), { ...prevGame, ...patch });
  return () => {
    if (prevList) qc.setQueryData(keys.games, prevList);
    if (prevGame) qc.setQueryData(keys.game(id), prevGame);
  };
}

export function useUpdateGame(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: GamePatch) => api.patch<GameDetail>(`/api/games/${id}`, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.game(id) });
      const { unlock: _unlock, stores: _stores, tags: _tags, ...plain } = patch;
      return { rollback: optimistic(qc, id, plain as Partial<GameDetail>) };
    },
    onError: (_e, _p, ctx) => ctx?.rollback(),
    onSuccess: (game) => qc.setQueryData(keys.game(id), game),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.games });
      qc.invalidateQueries({ queryKey: keys.stores });
    },
  });
}

/** Ocultar/mostrar direto do card: some da lista na hora. */
export function useSetHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
      api.patch<GameDetail>(`/api/games/${id}`, { hidden }),
    onMutate: async ({ id, hidden }) => {
      await qc.cancelQueries({ queryKey: keys.games });
      return { rollback: optimistic(qc, id, { hidden }) };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSuccess: (game) => qc.setQueryData(keys.game(game.id), game),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.games }),
  });
}

export function useCreateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: GameCreate) => api.post<GameDetail>("/api/games", data),
    onSuccess: (game) => {
      qc.setQueryData(keys.game(game.id), game);
      qc.invalidateQueries({ queryKey: keys.games });
      qc.invalidateQueries({ queryKey: keys.platforms });
      qc.invalidateQueries({ queryKey: keys.stores });
    },
  });
}

export function useDeleteGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/games/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: keys.game(id) });
      qc.invalidateQueries({ queryKey: keys.games });
      qc.invalidateQueries({ queryKey: keys.platforms });
      qc.invalidateQueries({ queryKey: keys.lists });
    },
  });
}

export function useAddComment(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<Comment>(`/api/games/${gameId}/comments`, { body }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: keys.game(gameId) });
      const prev = qc.getQueryData<GameDetail>(keys.game(gameId));
      if (prev) {
        const temp: Comment = { id: -Date.now(), body, created_at: new Date().toISOString().slice(0, 19), updated_at: null };
        qc.setQueryData<GameDetail>(keys.game(gameId), { ...prev, comments: [temp, ...prev.comments] });
      }
      return { prev };
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(keys.game(gameId), ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.game(gameId) }),
  });
}

export function useEditComment(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => api.patch<Comment>(`/api/comments/${id}`, { body }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.game(gameId) }),
  });
}

export function useDeleteComment(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/comments/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.game(gameId) }),
  });
}

export function useRefreshGame(gameId: number) {
  return useMutation({
    mutationFn: (data: RefreshIn = {}) => api.post<Job>(`/api/games/${gameId}/refresh`, data),
  });
}

export interface ConfirmLinkIn {
  provider: string;
  externalId: string;
  name?: string;
  url?: string | null;
  score?: number;
}

export function useConfirmLink(gameId: number) {
  return useMutation({
    // name/url/score: o escolhido veio de uma busca avulsa e não está entre os candidatos salvos.
    mutationFn: ({ provider, externalId, name, url, score }: ConfirmLinkIn) =>
      api.put<Job>(`/api/games/${gameId}/links/${provider}`, { external_id: externalId, name, url, score }),
  });
}

export function useIgnoreLink(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => api.del(`/api/games/${gameId}/links/${provider}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.game(gameId) });
      qc.invalidateQueries({ queryKey: keys.pending });
    },
  });
}

export function useEnrich() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: EnrichIn) => api.post<Job>("/api/jobs/enrich", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.jobs }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<Job>(`/api/jobs/${id}/cancel`),
    onSuccess: (job) => {
      qc.setQueryData(keys.job(job.id), job);
      qc.invalidateQueries({ queryKey: keys.jobs });
    },
  });
}

// ---------- catálogos ----------

export function useDeviceMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.devices });
  return {
    create: useMutation({ mutationFn: (d: DeviceIn) => api.post<Device>("/api/devices", d), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: number; patch: DevicePatch }) => api.patch<Device>(`/api/devices/${id}`, patch),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.del(`/api/devices/${id}`), onSuccess: done }),
  };
}

export function usePlatformMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: keys.platforms });
    qc.invalidateQueries({ queryKey: keys.devices });
  };
  return {
    create: useMutation({ mutationFn: (p: PlatformIn) => api.post<Platform>("/api/platforms", p), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: number; patch: PlatformPatch }) =>
        api.patch<Platform>(`/api/platforms/${id}`, patch),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.del(`/api/platforms/${id}`), onSuccess: done }),
  };
}

/** Depois de um job terminar: recarrega o que ele pode ter mudado. */
export function invalidateAfterJob(qc: QueryClient, gameIds: number[] = []) {
  qc.invalidateQueries({ queryKey: keys.games });
  qc.invalidateQueries({ queryKey: keys.pending });
  qc.invalidateQueries({ queryKey: keys.jobs });
  qc.invalidateQueries({ queryKey: keys.accounts });
  for (const id of gameIds) qc.invalidateQueries({ queryKey: keys.game(id) });
}

// ---------- contas de loja ----------

export const useAccounts = () =>
  useQuery({ queryKey: keys.accounts, queryFn: () => api.get<Account[]>("/api/accounts"), staleTime: 60_000 });

export const loginUrl = (store: StoreName) =>
  api.get<{ url: string }>(`/api/accounts/login-url${qs({ store })}`).then((r) => r.url);

export function useAccountMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: keys.accounts });
    qc.invalidateQueries({ queryKey: keys.jobs });
  };
  const changed = () => {
    done();
    qc.invalidateQueries({ queryKey: keys.games });
  };
  return {
    create: useMutation({ mutationFn: (a: AccountCreate) => api.post<Account>("/api/accounts", a), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: number; patch: AccountPatch }) => api.patch<Account>(`/api/accounts/${id}`, patch),
      onSuccess: changed,
    }),
    reconnect: useMutation({
      mutationFn: ({ id, ref }: { id: number; ref: string }) => api.post<Account>(`/api/accounts/${id}/reconnect`, { ref }),
      onSuccess: done,
    }),
    unignore: useMutation({ mutationFn: (id: number) => api.post<Account>(`/api/accounts/${id}/unignore`), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => api.del(`/api/accounts/${id}`), onSuccess: changed }),
  };
}

export function useSyncAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountIds?: number[]) => api.post<Job>("/api/accounts/sync", { account_ids: accountIds ?? null }),
    onSuccess: (job) => {
      qc.setQueryData(keys.job(job.id), job);
      qc.invalidateQueries({ queryKey: keys.jobs });
    },
  });
}

export function useMergeGame(targetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: number) => api.post<GameDetail>(`/api/games/${targetId}/merge`, { source_id: sourceId }),
    onSuccess: (game, sourceId) => {
      qc.setQueryData(keys.game(game.id), game);
      qc.removeQueries({ queryKey: keys.game(sourceId) });
      qc.invalidateQueries({ queryKey: keys.games });
      qc.invalidateQueries({ queryKey: keys.accounts });
      qc.invalidateQueries({ queryKey: keys.lists });
    },
  });
}

// ---------- listas ----------

export const useLists = () =>
  useQuery({ queryKey: keys.lists, queryFn: () => api.get<GameList[]>("/api/lists"), staleTime: 30_000 });

/** Troca os jogos de uma lista no cache na hora; devolve o rollback. */
function optimisticList(qc: QueryClient, listId: number, change: (ids: number[]) => number[]) {
  const prev = qc.getQueryData<GameList[]>(keys.lists);
  if (prev) {
    qc.setQueryData<GameList[]>(
      keys.lists,
      prev.map((l) => (l.id === listId ? { ...l, game_ids: change(l.game_ids) } : l)),
    );
  }
  return () => prev && qc.setQueryData(keys.lists, prev);
}

export function useListMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.lists });
  // Pôr, tirar e reordenar mudam o cache na hora. Arrastando vários seguidos, só a última volta da API
  // recarrega: uma resposta antiga desfaria na tela o que a pessoa acabou de mover.
  const games = {
    mutationKey: keys.lists,
    onError: (_e: unknown, _v: unknown, ctx: { rollback: () => void } | undefined) => ctx?.rollback(),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: keys.lists }) === 1) done();
    },
  };
  return {
    create: useMutation({ mutationFn: (l: GameListCreate) => api.post<GameList>("/api/lists", l), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: number; patch: GameListPatch }) => api.patch<GameList>(`/api/lists/${id}`, patch),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.del(`/api/lists/${id}`), onSuccess: done }),
    add: useMutation({
      ...games,
      mutationFn: ({ listId, gameId }: { listId: number; gameId: number }) =>
        api.post<GameList>(`/api/lists/${listId}/games`, { game_id: gameId }),
      onMutate: async ({ listId, gameId }) => {
        await qc.cancelQueries({ queryKey: keys.lists });
        return { rollback: optimisticList(qc, listId, (ids) => (ids.includes(gameId) ? ids : [...ids, gameId])) };
      },
    }),
    removeGame: useMutation({
      ...games,
      mutationFn: ({ listId, gameId }: { listId: number; gameId: number }) =>
        api.del<GameList>(`/api/lists/${listId}/games/${gameId}`),
      onMutate: async ({ listId, gameId }) => {
        await qc.cancelQueries({ queryKey: keys.lists });
        return { rollback: optimisticList(qc, listId, (ids) => ids.filter((id) => id !== gameId)) };
      },
    }),
    reorder: useMutation({
      ...games,
      mutationFn: ({ listId, gameIds }: { listId: number; gameIds: number[] }) =>
        api.put<GameList>(`/api/lists/${listId}/games`, { game_ids: gameIds }),
      onMutate: async ({ listId, gameIds }) => {
        await qc.cancelQueries({ queryKey: keys.lists });
        return { rollback: optimisticList(qc, listId, () => gameIds) };
      },
    }),
  };
}

// ---------- login e usuários ----------

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api.get<AuthMe>("/api/auth/me"), staleTime: 300_000 });

/** Entrar/sair troca de dono: nada do cache do usuário anterior pode sobrar. */
function startFresh(qc: QueryClient) {
  qc.clear();
  return qc.invalidateQueries({ queryKey: keys.me });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: LoginIn) => api.post<User>("/api/auth/login", data),
    onSuccess: () => startFresh(qc),
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SignupIn) => api.post<User>("/api/auth/signup", data),
    onSuccess: () => startFresh(qc),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.post<void>("/api/auth/logout"), onSuccess: () => startFresh(qc) });
}

export const useChangePassword = () =>
  useMutation({
    mutationFn: (data: { current_password: string; new_password: string }) =>
      api.post<void>("/api/auth/password", data),
  });

export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: keys.users, queryFn: () => api.get<UserAdmin[]>("/api/users"), enabled });

export function useUserMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.users });
  return {
    create: useMutation({ mutationFn: (u: UserCreate) => api.post<UserAdmin>("/api/users", u), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: number; patch: UserPatch }) => api.patch<UserAdmin>(`/api/users/${id}`, patch),
      onSuccess: done,
    }),
    resetPassword: useMutation({
      mutationFn: ({ id, password }: { id: number; password: string }) =>
        api.post<void>(`/api/users/${id}/password`, { password }),
    }),
    remove: useMutation({ mutationFn: (id: number) => api.del(`/api/users/${id}`), onSuccess: done }),
  };
}

// ---------- configurações ----------

export const useApiKeys = (enabled: boolean) =>
  useQuery({ queryKey: keys.apiKeys, queryFn: () => api.get<ApiKeys>("/api/settings/keys"), enabled });

export function useSaveApiKeys() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ApiKeysPatch) => api.put<ApiKeys>("/api/settings/keys", patch),
    onSuccess: (saved) => {
      qc.setQueryData(keys.apiKeys, saved);
      qc.invalidateQueries({ queryKey: keys.meta });
    },
  });
}

export const useTestApiKey = () =>
  useMutation({
    mutationFn: (provider: KeyTestProvider) => api.post<KeyTestResult>("/api/settings/keys/test", { provider }),
  });

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => api.patch<User>("/api/settings/profile", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.me });
      qc.invalidateQueries({ queryKey: ["public"] });
    },
  });
}

// ---------- página pública ----------

export const usePublicProfile = (username: string) =>
  useQuery({
    queryKey: keys.publicProfile(username),
    queryFn: () => api.get<PublicProfile>(`/api/public/${encodeURIComponent(username)}`),
    staleTime: 60_000,
  });
