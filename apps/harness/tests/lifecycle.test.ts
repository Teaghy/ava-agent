import { describe, expect, it } from 'vitest';
import { createContext } from '../src/bootstrap/context.js';
import { cacheMemoryPlugin } from '../src/plugins/cache-memory/index.js';
import { decisionSchema } from '../src/core/agent/agent-decision.js';
import { readFile, readdir } from 'node:fs/promises';
describe('Cordis lifecycle and architecture', () => {
  it('activates dependency consumers then disposes their effects with the provider', async () => {
    const ctx = createContext();
    let active = 0;
    const consumer = ctx.plugin({
      name: 'consumer',
      inject: ['cache'],
      apply(child) {
        child.effect(() => {
          active++;
          return () => {
            active--;
          };
        });
      },
    });
    const provider = ctx.plugin(cacheMemoryPlugin);
    try {
      await Promise.all([consumer, provider]);
      expect(active).toBe(1);
      await provider.dispose();
      expect(active).toBe(0);
    } finally {
      await ctx.fiber.dispose();
    }
  });
  it('keeps core/runtime/API modules free of provider SDK and transport imports', async () => {
    const walk = async (url: URL): Promise<URL[]> => {
      const entries = await readdir(url, { withFileTypes: true });
      return (
        await Promise.all(
          entries.map((entry) =>
            entry.isDirectory() ? walk(new URL(`${entry.name}/`, url)) : [new URL(entry.name, url)],
          ),
        )
      ).flat();
    };
    const files = [
      ...(await walk(new URL('../src/core/', import.meta.url))),
      new URL('../src/plugins/agent-loop/react-loop.ts', import.meta.url),
      new URL('../src/plugins/chat-api/index.ts', import.meta.url),
      new URL('../src/plugins/knowledge-api/index.ts', import.meta.url),
    ];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content, file.pathname).not.toMatch(
        /from ['"](?:h3|openai|pg|ioredis|@qdrant|drizzle-orm|.*plugins\/)/,
      );
    }
    expect(decisionSchema.safeParse({ type: 'ask_user', question: '设备型号？' }).success).toBe(
      true,
    );
    const loop = await readFile(
      new URL('../src/plugins/agent-loop/react-loop.ts', import.meta.url),
      'utf8',
    );
    expect(loop).toContain('ctx.decision.decide');
    expect(loop).not.toMatch(/ctx\.model\b|structuredOutput|ContextBuilder/);
  });
});
