import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';
const harness = await createHarness({ ...loadConfig(), SEED_KNOWLEDGE: true });
await harness.stop();
