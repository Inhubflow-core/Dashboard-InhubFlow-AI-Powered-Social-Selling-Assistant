// Caché corta compartida en memoria del servidor para /api/unipile/accounts
const ACCOUNTS_CACHE_TTL_MS = 2 * 60 * 1000;

let cachedAccountsPayload: { expiresAt: number; payload: unknown } | null = null;
let inFlightAccountsFetch: Promise<unknown> | null = null;

export function getCachedAccountsPayload(): unknown | null {
  if (cachedAccountsPayload && cachedAccountsPayload.expiresAt > Date.now()) {
    return cachedAccountsPayload.payload;
  }
  return null;
}

export function setCachedAccountsPayload(payload: unknown): void {
  cachedAccountsPayload = {
    expiresAt: Date.now() + ACCOUNTS_CACHE_TTL_MS,
    payload,
  };
}

export function invalidateAccountsCache(): void {
  cachedAccountsPayload = null;
  inFlightAccountsFetch = null;
}

export function getInFlightAccountsFetch(): Promise<unknown> | null {
  return inFlightAccountsFetch;
}

export function setInFlightAccountsFetch(promise: Promise<unknown> | null): void {
  inFlightAccountsFetch = promise;
}
