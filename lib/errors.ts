export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export function errorResponse(reason: unknown) {
  const error = reason instanceof AppError
    ? reason
    : new AppError("internal_error", "The stage hit an unexpected problem.", 500, true);

  return Response.json(
    { error: { code: error.code, message: error.message, retryable: error.retryable } },
    { status: error.status },
  );
}
