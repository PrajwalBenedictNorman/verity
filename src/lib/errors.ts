export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function jsonOk<T>(data: T, status = 200) {
  return Response.json({ ok: true, data }, { status });
}

export function jsonError(code: string, message: string, status = 400) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export function toErrorResponse(err: unknown) {
  if (err instanceof AppError) {
    return jsonError(err.code, err.message, err.status);
  }
  console.error(err);
  return jsonError("internal", "Something went wrong", 500);
}
