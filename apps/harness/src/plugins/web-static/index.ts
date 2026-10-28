import type { Context } from 'cordis';
import { fileURLToPath } from 'node:url';
import { configSchema, MAX_MESSAGE_LENGTH, type ClientConfig } from '@ava/protocol';
export type WebStaticConfig = Omit<ClientConfig, 'maxMessageLength'>;
export const webStaticPlugin = {
  name: 'web-static',
  inject: ['http'],
  apply(ctx: Context, config: WebStaticConfig | (() => WebStaticConfig)) {
    ctx.effect(() =>
      ctx.http.static('/', fileURLToPath(new URL('../../../../web/dist/', import.meta.url))),
    );
    ctx.effect(() =>
      ctx.http.get('/api/v1/client-config', async () => ({
        headers: { 'cache-control': 'no-store' },
        body: configSchema.parse({
          ...(typeof config === 'function' ? config() : config),
          maxMessageLength: MAX_MESSAGE_LENGTH,
        }),
      })),
    );
  },
};
