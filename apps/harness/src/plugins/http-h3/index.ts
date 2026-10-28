import type { Context } from 'cordis';
import { H3HttpService } from './http.service.js';
export { H3HttpService } from './http.service.js';
export const httpH3Plugin = {
  name: 'http-h3',
  provide: ['http'],
  apply(ctx: Context) {
    const service = new H3HttpService();
    ctx.provide('http', service);
    ctx.effect(() => () => service.stop());
  },
};
