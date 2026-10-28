export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function publicError(error: unknown): { code: string; message: string } {
  return error instanceof AppError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: '请求处理失败，请稍后重试。' };
}
export function checkAbort(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
