import { createServer, type Server } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import {
  createApp,
  eventHandler,
  toNodeListener,
  getRequestURL,
  getHeader,
  createEventStream,
  setResponseStatus,
  setHeaders,
  send,
} from 'h3';
import type { HttpHandler } from '../../core/http/http.types.js';
import type { HttpService } from '../../core/http/http.service.js';
import { AppError, publicError } from '../../core/errors.js';
export class H3HttpService implements HttpService {
  private handlers = new Map<string, HttpHandler>();
  private server?: Server;
  private active = new Set<AbortController>();
  private staticDirectories = new Map<string, string>();
  static(prefix: string, directory: string): () => void {
    if (this.staticDirectories.has(prefix)) throw new Error(`Duplicate static prefix ${prefix}`);
    this.staticDirectories.set(prefix, directory);
    return () => {
      this.staticDirectories.delete(prefix);
    };
  }
  private async asset(path: string): Promise<{ content: Buffer; type: string } | undefined> {
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    };
    for (const [prefix, directory] of this.staticDirectories) {
      if (!path.startsWith(prefix)) continue;
      const relative = path.slice(prefix.length) || 'index.html';
      if (relative.split(/[\\/]/).some((p) => p.startsWith('.'))) continue;
      const type = types[extname(relative)];
      if (!type) continue;
      try {
        const root = await realpath(directory);
        const file = await realpath(resolve(root, relative));
        if (!file.startsWith(root + sep)) continue;
        return { content: await readFile(file), type };
      } catch {
        /* Missing assets remain ordinary 404 responses. */
      }
    }
    return undefined;
  }
  route(method: 'get' | 'post', path: string, handler: HttpHandler): () => void {
    const key = `${method.toUpperCase()} ${path}`;
    if (this.handlers.has(key)) throw new Error(`Duplicate route ${key}`);
    this.handlers.set(key, handler);
    return () => {
      this.handlers.delete(key);
    };
  }
  get(path: string, handler: HttpHandler) {
    return this.route('get', path, handler);
  }
  post(path: string, handler: HttpHandler) {
    return this.route('post', path, handler);
  }
  async start(port: number, host = '127.0.0.1'): Promise<number> {
    if (this.server) throw new Error('HTTP already started');
    const app = createApp();
    app.use(
      eventHandler(async (event) => {
        const controller = new AbortController();
        this.active.add(controller);
        const abort = () => {
          controller.abort();
          this.active.delete(controller);
        };
        event.node.req.once('aborted', abort);
        event.node.res.once('close', abort);
        try {
          const path = getRequestURL(event).pathname;
          const handler = this.handlers.get(`${event.method} ${path}`);
          if (!handler && (event.method === 'GET' || event.method === 'HEAD')) {
            const asset = await this.asset(path);
            if (asset) {
              setHeaders(event, {
                'cache-control': 'no-cache',
                'x-content-type-options': 'nosniff',
                ...(asset.type.startsWith('text/html')
                  ? {
                      'content-security-policy':
                        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
                    }
                  : {}),
              });
              return send(event, event.method === 'HEAD' ? undefined : asset.content, asset.type);
            }
          }
          if (!handler) throw new AppError('NOT_FOUND', '接口不存在。', 404);
          const response = await handler({
            header: (name) => getHeader(event, name),
            signal: controller.signal,
            async body() {
              const advertisedSize = Number(getHeader(event, 'content-length') ?? 0);
              if (advertisedSize > 65536)
                throw new AppError('BODY_TOO_LARGE', '请求体不得超过 64 KB。', 413);
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of event.node.req) {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                size += buffer.length;
                if (size > 65536) {
                  // Drain chunked requests without buffering the remainder before returning 413.
                  continue;
                }
                chunks.push(buffer);
              }
              if (size > 65536) throw new AppError('BODY_TOO_LARGE', '请求体不得超过 64 KB。', 413);
              try {
                return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
              } catch {
                throw new AppError('INVALID_JSON', '请求体必须是 JSON。', 400);
              }
            },
          });
          if (!response.stream) {
            if (response.headers) setHeaders(event, response.headers);
            setResponseStatus(event, response.status ?? 200);
            return response.body ?? null;
          }
          event.node.res.setHeader('X-Accel-Buffering', 'no');
          event.node.res.setHeader('Cache-Control', 'no-cache, no-transform');
          const stream = createEventStream(event);
          stream.onClosed(abort);
          const streamResponse = stream.send();
          const heartbeat = setInterval(() => {
            void stream.push({ event: 'ping', data: '{}' }).catch(abort);
          }, 15000);
          void (async () => {
            try {
              await response.stream!(async (item) => {
                controller.signal.throwIfAborted();
                await stream.push({ event: item.type, data: JSON.stringify(item.data) });
              }, controller.signal);
            } catch (error) {
              if (!controller.signal.aborted)
                await stream
                  .push({ event: 'error', data: JSON.stringify(publicError(error)) })
                  .catch(abort);
            } finally {
              clearInterval(heartbeat);
              await stream.close().catch(abort);
              this.active.delete(controller);
            }
          })();
          return streamResponse;
        } catch (error) {
          setResponseStatus(event, error instanceof AppError ? error.status : 500);
          return { error: publicError(error) };
        }
      }),
    );
    const server = createServer(toNodeListener(app));
    this.server = server;
    server.requestTimeout = 100000;
    server.headersTimeout = 10000;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      this.server = undefined;
      throw error;
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No HTTP address');
    return address.port;
  }
  async stop(): Promise<void> {
    this.active.forEach((c) => c.abort());
    this.active.clear();
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
}
