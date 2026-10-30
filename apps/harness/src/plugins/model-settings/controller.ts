import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  modelApplySchema,
  modelConnectionSchema,
  embeddingConnectionSchema,
  type ModelApplyRequest,
  type ModelJob,
  type ModelSettingsView,
  modelCompatibilitySchema,
  defaultModelCompatibility,
} from '@ava/protocol';
import type { Config } from '../../config/index.js';
import type { Context } from '../../bootstrap/context.js';
import type { ModelService } from '../../core/model/model.service.js';
import type { EmbeddingService } from '../../core/embedding/embedding.service.js';
import type { VectorService } from '../../core/vector/vector.service.js';
import type { StorageService } from '../../core/storage/storage.service.js';
import type { TelemetryService } from '../../core/observability/telemetry.service.js';
import { AppError, publicError, checkAbort } from '../../core/errors.js';
import { OpenAICompatibleModelService } from '../model-openai/index.js';
import { OpenAIEmbedding } from '../embedding-openai/index.js';
import { ModelCompatibilityRegistry } from '../model-compatibility/index.js';
import type { ModelCompatibilityService } from '../../core/model/model-compatibility.service.js';

const storedSchema = z.object({
  llm: modelConnectionSchema.extend({
    apiKey: z.string(),
    compatibility: modelCompatibilitySchema.default(defaultModelCompatibility),
  }),
  embedding: embeddingConnectionSchema.extend({
    apiKey: z.string(),
    collection: z.string().min(1),
  }),
});
type Settings = z.infer<typeof storedSchema>;
type Maintenance = <T>(operation: () => Promise<T>) => Promise<T>;
export class ModelSettingsController {
  private current: Settings;
  private revision = 0;
  private source: 'env' | 'ops' = 'env';
  private job?: ModelJob;
  private pending?: Promise<void>;
  private closed = false;
  private lifetime = new AbortController();
  private modelDelegate?: ModelService;
  private embeddingDelegate?: EmbeddingService;
  private vectorDelegate?: VectorService;
  private maintenance!: Maintenance;
  private storage!: () => StorageService;
  readonly secrets: string[];
  private constructor(
    private config: Config,
    private statePath: string | false,
    private makeVector: (collection: string, dimensions: number) => Promise<VectorService>,
    private unavailableReason: () => string | undefined,
    private telemetry: () => TelemetryService | undefined,
    private compatibility: ModelCompatibilityService,
  ) {
    this.current = storedSchema.parse({
      llm: {
        baseURL: config.LLM_BASE_URL,
        model: config.LLM_MODEL,
        apiKey: config.LLM_API_KEY,
        compatibility: {
          messageFormat: config.LLM_MESSAGE_FORMAT,
          jsonOutput: config.LLM_JSON_OUTPUT,
          streamUsage: config.LLM_STREAM_USAGE,
        },
      },
      embedding: {
        baseURL: config.EMBEDDING_BASE_URL,
        model: config.EMBEDDING_MODEL,
        apiKey: config.EMBEDDING_API_KEY,
        dimensions: config.EMBEDDING_DIMENSIONS,
        batchSize: config.EMBEDDING_BATCH_SIZE,
        collection: config.QDRANT_COLLECTION,
      },
    });
    this.secrets = [
      ...Object.keys(config.API_KEYS),
      ...Object.keys(config.OPS_API_KEYS),
      config.LLM_API_KEY,
      config.EMBEDDING_API_KEY,
      config.MEM0_API_KEY,
      config.QDRANT_API_KEY,
    ].filter(Boolean);
  }
  static async prepare(
    config: Config,
    statePath: string | false,
    makeVector: (collection: string, dimensions: number) => Promise<VectorService>,
    unavailableReason: () => string | undefined,
    telemetry: () => TelemetryService | undefined,
    compatibility: ModelCompatibilityService = new ModelCompatibilityRegistry(),
  ): Promise<ModelSettingsController> {
    const controller = new ModelSettingsController(
      config,
      statePath,
      makeVector,
      unavailableReason,
      telemetry,
      compatibility,
    );
    if (controller.statePath) {
      try {
        const value = z
          .object({
            version: z.literal(1),
            revision: z.number().int().nonnegative(),
            settings: storedSchema,
          })
          .strict()
          .parse(JSON.parse(await readFile(controller.statePath, 'utf8')));
        controller.current = value.settings;
        controller.revision = value.revision;
        controller.source = 'ops';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new AppError(
            'MODEL_STATE_INVALID',
            '无法读取模型配置，请检查本地模型配置文件。',
            500,
          );
      }
    }
    controller.addSecrets(controller.current);
    return controller;
  }
  bind(storage: () => StorageService, maintenance: Maintenance) {
    this.storage = storage;
    this.maintenance = maintenance;
  }
  private addSecrets(settings: Settings) {
    for (const key of [settings.llm.apiKey, settings.embedding.apiKey])
      if (key && !this.secrets.includes(key)) this.secrets.push(key);
  }
  view(): ModelSettingsView {
    const { apiKey: llmKey, ...llm } = this.current.llm;
    const { apiKey: embeddingKey, ...embedding } = this.current.embedding;
    const reason =
      this.config.APP_MODE !== 'live'
        ? '当前为 mock 模式；在线切换需要 live 部署。'
        : this.unavailableReason();
    return {
      enabled: !reason,
      ...(reason ? { reason } : {}),
      persistent: !!this.statePath,
      source: this.source,
      revision: this.revision,
      llm: {
        ...llm,
        keyConfigured: !!llmKey,
        effectiveCompatibility: this.compatibility.resolve(llm, llm.compatibility),
      },
      embedding: { ...embedding, keyConfigured: !!embeddingKey },
      ...(this.job ? { job: structuredClone(this.job) } : {}),
    };
  }
  private model(): ModelService {
    if (!this.current.llm.apiKey)
      throw new AppError('MODEL_NOT_CONFIGURED', '请由维护人员在 Ops 配置语言模型 Key。', 503);
    return (this.modelDelegate ??= new OpenAICompatibleModelService(
      this.current.llm,
      this.telemetry(),
      this.compatibility,
    ));
  }
  private embedding(): EmbeddingService {
    if (!this.current.embedding.apiKey)
      throw new AppError('EMBEDDING_NOT_CONFIGURED', '请由维护人员在 Ops 配置向量模型 Key。', 503);
    return (this.embeddingDelegate ??= new OpenAIEmbedding(this.current.embedding));
  }
  readonly modelService: ModelService = {
    chat: async (request) => this.model().chat(request),
    structuredOutput: async (schema, request) => this.model().structuredOutput(schema, request),
    stream: (request) => this.model().stream(request),
  };
  readonly embeddingService: EmbeddingService = {
    embed: async (text, signal) => this.embedding().embed(text, signal),
    embedMany: async (texts, signal) => this.embedding().embedMany(texts, signal),
  };
  readonly vectorService: VectorService = {
    search: (...args) => this.vector().search(...args),
    upsert: (points) => this.vector().upsert(points),
    delete: (ids) => this.vector().delete(ids),
  };
  private vector() {
    if (!this.vectorDelegate) throw new AppError('VECTOR_NOT_READY', '知识索引尚未就绪。', 503);
    return this.vectorDelegate;
  }
  async initializeVector() {
    this.vectorDelegate = await this.makeVector(
      this.current.embedding.collection,
      this.current.embedding.dimensions,
    );
  }
  readonly modelPlugin = {
    name: 'model-openai',
    provide: ['model'],
    apply: (ctx: Context) => {
      ctx.provide('model', this.modelService);
    },
  };
  readonly embeddingPlugin = {
    name: 'embedding',
    provide: ['embedding'],
    apply: (ctx: Context) => {
      ctx.provide('embedding', this.embeddingService);
    },
  };
  readonly vectorPlugin = {
    name: 'vector-qdrant',
    provide: ['vector'],
    apply: async (ctx: Context) => {
      await this.initializeVector();
      ctx.provide('vector', this.vectorService);
    },
  };
  apply(request: ModelApplyRequest): ModelSettingsView {
    if (this.closed) throw new AppError('MODEL_SETTINGS_STOPPING', '服务正在关闭。', 503);
    const view = this.view();
    if (!view.enabled) throw new AppError('MODEL_SETTINGS_UNAVAILABLE', view.reason!, 409);
    if (this.pending)
      throw new AppError('MODEL_CHANGE_IN_PROGRESS', '已有模型切换任务，请等待完成。', 409);
    const input = modelApplySchema.parse(request);
    if (input.revision !== this.revision)
      throw new AppError('MODEL_SETTINGS_CONFLICT', '配置已更新，请刷新后再保存。', 409);
    const next = structuredClone(this.current);
    if (input.llm)
      next.llm = {
        ...input.llm,
        compatibility:
          input.llm.compatibility ??
          (input.llm.baseURL !== next.llm.baseURL || input.llm.model !== next.llm.model
            ? defaultModelCompatibility
            : next.llm.compatibility),
        apiKey: input.llm.apiKey === undefined ? next.llm.apiKey : (input.llm.apiKey ?? ''),
      };
    if (input.embedding)
      next.embedding = {
        ...input.embedding,
        collection: next.embedding.collection,
        apiKey:
          input.embedding.apiKey === undefined
            ? next.embedding.apiKey
            : (input.embedding.apiKey ?? ''),
      };
    this.addSecrets(next);
    const job: ModelJob = {
      id: randomUUID(),
      status: 'queued',
      processed: 0,
      total: 0,
      startedAt: new Date().toISOString(),
    };
    this.job = job;
    const previous = {
      settings: this.current,
      revision: this.revision,
      source: this.source,
      model: this.modelDelegate,
      embedding: this.embeddingDelegate,
      vector: this.vectorDelegate,
    };
    this.pending = this.maintenance(async () => {
      if (this.unavailableReason())
        throw new AppError(
          'MODEL_SETTINGS_UNAVAILABLE',
          '请先停用自定义模型或向量 Provider。',
          409,
        );
      await this.update(next, job, this.lifetime.signal);
    })
      .then(() => {
        job.status = 'completed';
        job.finishedAt = new Date().toISOString();
      })
      .catch(async (error) => {
        // A failed Agent restart must not leave the next boot on an unacknowledged configuration.
        if (this.revision !== previous.revision) {
          this.current = previous.settings;
          this.revision = previous.revision;
          this.source = previous.source;
          this.modelDelegate = previous.model;
          this.embeddingDelegate = previous.embedding;
          this.vectorDelegate = previous.vector;
          try {
            if (previous.source === 'env' && this.statePath)
              await rm(this.statePath, { force: true });
            else await this.persist(previous.settings, previous.revision);
          } catch {
            error = new AppError(
              'MODEL_ROLLBACK_FAILED',
              '模型配置文件恢复失败，请停止服务并检查本地模型配置文件。',
              503,
            );
          }
        }
        job.status = 'failed';
        job.error = publicError(error).message;
        job.finishedAt = new Date().toISOString();
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.view();
  }
  private async update(next: Settings, job: ModelJob, signal: AbortSignal) {
    checkAbort(signal);
    job.status = 'validating';
    const model = next.llm.apiKey
      ? new OpenAICompatibleModelService(next.llm, this.telemetry(), this.compatibility)
      : undefined;
    const embedding = next.embedding.apiKey ? new OpenAIEmbedding(next.embedding) : undefined;
    const llmChanged =
      next.llm.baseURL !== this.current.llm.baseURL ||
      next.llm.model !== this.current.llm.model ||
      next.llm.apiKey !== this.current.llm.apiKey ||
      JSON.stringify(next.llm.compatibility) !== JSON.stringify(this.current.llm.compatibility);
    const embeddingChanged =
      next.embedding.baseURL !== this.current.embedding.baseURL ||
      next.embedding.model !== this.current.embedding.model ||
      next.embedding.dimensions !== this.current.embedding.dimensions ||
      next.embedding.batchSize !== this.current.embedding.batchSize ||
      next.embedding.apiKey !== this.current.embedding.apiKey;
    const unchanged = !llmChanged && !embeddingChanged;
    if (model && (llmChanged || unchanged)) {
      job.checks = { structuredOutput: false, streaming: false };
      const messages = [
        { role: 'system' as const, content: '这是模型连接测试。只按最后一个用户问题回答。' },
        { role: 'user' as const, content: '请确认收到测试请求。' },
        { role: 'assistant' as const, content: '已收到。' },
        { role: 'user' as const, content: '请只返回 JSON：{"ok":true}' },
      ];
      await model.structuredOutput(z.object({ ok: z.literal(true) }).strict(), {
        messages,
        signal,
      });
      job.checks.structuredOutput = true;
      if (this.config.ANSWER_STREAMING) {
        let visible = false;
        for await (const delta of model.stream({
          messages: [...messages.slice(0, -1), { role: 'user', content: '请只回复 OK。' }],
          signal,
        }))
          if (delta.text.trim()) visible = true;
        if (!visible)
          throw new AppError(
            'MODEL_STREAM_EMPTY',
            '模型未输出可见的流式正文，请检查模型的流式能力或推理参数。',
            502,
          );
        job.checks.streaming = true;
      }
    }
    if (embedding && (embeddingChanged || unchanged)) await embedding.embed('模型连接验证', signal);
    const old = this.current.embedding;
    const changed =
      old.baseURL !== next.embedding.baseURL ||
      old.model !== next.embedding.model ||
      old.dimensions !== next.embedding.dimensions;
    let vector = this.vectorDelegate;
    if (changed) {
      if (!embedding)
        throw new AppError('EMBEDDING_NOT_CONFIGURED', '切换向量模型前请填写 Key。', 400);
      const storage = this.storage();
      if (!storage.scanKnowledgeChunks)
        throw new AppError('REINDEX_UNAVAILABLE', '当前存储 Provider 不支持知识索引重建。', 409);
      next.embedding.collection = `knowledge_models_${next.embedding.dimensions}_${randomUUID().replaceAll('-', '')}`;
      vector = await this.makeVector(next.embedding.collection, next.embedding.dimensions);
      job.status = 'reindexing';
      let after: string | undefined;
      for (;;) {
        checkAbort(signal);
        const chunks = await storage.scanKnowledgeChunks(after, 100);
        if (!chunks.length) break;
        job.total += chunks.length;
        const vectors = await embedding.embedMany(
          chunks.map((chunk) => `${chunk.title}\n${chunk.content}`),
          signal,
        );
        await vector.upsert(
          chunks.map((document, index) => ({ id: document.id, document, vector: vectors[index]! })),
        );
        job.processed += chunks.length;
        after = chunks.at(-1)!.id;
      }
    }
    checkAbort(signal);
    job.status = 'applying';
    await this.persist(next, this.revision + 1);
    // No await between swapping delegates: callers can only observe a complete model/index pair.
    this.current = next;
    this.modelDelegate = model;
    this.embeddingDelegate = embedding;
    this.vectorDelegate = vector;
    this.revision++;
    this.source = 'ops';
  }
  private async persist(settings: Settings, revision: number) {
    if (!this.statePath) return;
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.statePath), { recursive: true });
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, revision, settings }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
      await rename(temporary, this.statePath);
    } catch {
      throw new AppError('MODEL_STATE_WRITE_FAILED', '模型配置保存失败，未切换运行配置。', 500);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  async close() {
    this.closed = true;
    this.lifetime.abort();
    await this.pending;
  }
}
