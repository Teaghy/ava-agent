import { z } from 'zod';
export const errorResponseSchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string() }),
});
