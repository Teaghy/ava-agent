import { cp } from 'node:fs/promises';
await cp(new URL('../src/prompts', import.meta.url), new URL('../dist/prompts', import.meta.url), {
  recursive: true,
});
await cp(new URL('../../ops/dist', import.meta.url), new URL('../dist/ops', import.meta.url), {
  recursive: true,
  force: true,
});
