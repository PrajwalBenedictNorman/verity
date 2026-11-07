type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export async function apiRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => null)) as ApiResult<T> | null;
  if (!res.ok || !json || !json.ok) {
    const message =
      json && !json.ok ? json.error.message : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return json.data;
}
