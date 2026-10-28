import type { Context } from 'cordis';
import pino from 'pino';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { TelemetryService } from '../../core/observability/telemetry.service.js';
export const observabilityPlugin = {
  name: 'observability',
  provide: ['telemetry'],
  async apply(ctx: Context, config: { enabled: boolean; endpoint: string; quiet?: boolean }) {
    if (config.enabled) {
      const { NodeSDK } = await import('@opentelemetry/sdk-node');
      const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
      const sdk = new NodeSDK({
        serviceName: 'ava-agent-harness',
        traceExporter: new OTLPTraceExporter({
          url: `${config.endpoint.replace(/\/$/, '')}/v1/traces`,
        }),
      });
      sdk.start();
      ctx.effect(() => () => sdk.shutdown());
    }
    const logger = pino({
      level: config.quiet ? 'silent' : 'info',
      redact: ['apiKey', 'authorization', '*.apiKey'],
    });
    const tracer = trace.getTracer('ava-harness');
    const service: TelemetryService = {
      span: (name, attributes, fn) =>
        tracer.startActiveSpan(name, { attributes }, async (span) => {
          try {
            return await fn();
          } catch (error) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            if (error instanceof Error) span.recordException(error);
            throw error;
          } finally {
            span.end();
          }
        }),
      log(data, message) {
        logger.info({ ...data, trace_id: trace.getActiveSpan()?.spanContext().traceId }, message);
      },
    };
    ctx.provide('telemetry', service);
    ctx.on('harness/event', (event) =>
      service.log(
        { run_id: event.runId, conversation_id: event.conversationId, event: event.type },
        'agent event',
      ),
    );
  },
};
