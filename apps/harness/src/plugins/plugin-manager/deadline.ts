import { AppError } from '../../core/errors.js';

/** Bound control-plane waits; this cannot terminate uncooperative in-process code. */
export async function withPluginDeadline<T>(
  operation: PromiseLike<T>,
  timeout: number,
  code: string,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AppError(code, message, 503)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
