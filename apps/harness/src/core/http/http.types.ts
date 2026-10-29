import type { StreamEventType } from '@ava/protocol';
export interface StreamEvent {
  type: StreamEventType;
  data: unknown;
}

export interface HttpRequest {
  body(): Promise<unknown>;
  bytes?(maxBytes: number): Promise<Uint8Array>;
  header(name: string): string | undefined;
  signal: AbortSignal;
}

export interface HttpResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  stream?: (emit: (event: StreamEvent) => Promise<void>, signal: AbortSignal) => Promise<void>;
}

export type HttpHandler = (request: HttpRequest) => Promise<HttpResponse>;
