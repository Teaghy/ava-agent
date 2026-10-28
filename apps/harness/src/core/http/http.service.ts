import type { HttpHandler } from './http.types.js';
export interface HttpService {
  static(prefix: string, directory: string): () => void;
  route(method: 'get' | 'post', path: string, handler: HttpHandler): () => void;
  get(path: string, handler: HttpHandler): () => void;
  post(path: string, handler: HttpHandler): () => void;
  start(port: number, host?: string): Promise<number>;
  stop(): Promise<void>;
}
