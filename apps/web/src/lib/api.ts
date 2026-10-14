export type ApiErrorPayload = { error: { code: string; message: string } };
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "ApiError"; }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) {
    const token = document.cookie.split("; ").find((part) => part.startsWith("ss_csrf="))?.split("=").slice(1).join("=");
    if (token) headers.set("X-CSRF-Token", decodeURIComponent(token));
  }
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: "include" });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as ApiErrorPayload | null;
    throw new ApiError(response.status, error?.error?.code ?? "REQUEST_FAILED", error?.error?.message ?? "The request failed.");
  }
  return payload as T;
}

export type Session = { authenticated: boolean; spotifyConfigured: boolean; csrfToken?: string; user?: { id: string; displayName: string | null; spotifyConnected: boolean; grantedScopes: string[] } };
export type Summary = { events: number; listeningMilliseconds: number; durationCoverage: number | null; uniqueTracks: number; uniqueArtists: number; uniqueAlbums: number; averageEventsPerDay: number; skippedRate: number | null; skippedRateCoverage: string; firstPlay: string | null; timezone: string; coverage: { earliest: string | null; latest: string | null; lastImportedAt: string | null; imports: number; totalRecords: number; importedRecords: number; skippedRecords: number; failedRecords: number; isComplete: boolean; completenessNote: string } };
export type RankItem = { rank: number; name: string | null; artist?: string; album?: string | null; events: number; minutes: number; skippedEvents: number };
