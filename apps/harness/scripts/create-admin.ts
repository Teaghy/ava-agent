import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createMemberSchema, identityIdSchema } from '@ava/protocol';
import { loadConfig } from '../src/config/index.js';
import { hashPassword } from '../src/core/identity/password.js';
import { PostgresIdentityStore } from '../src/plugins/storage-postgres/identity-store.js';
import * as schema from '../src/plugins/storage-postgres/schema/index.js';

const config = loadConfig();
if (!config.LOCAL_AUTH_ENABLED) throw new Error('请先配置 LOCAL_AUTH_ENABLED=true。');
if (config.APP_MODE === 'mock' && config.INFRA_MODE !== 'external')
  throw new Error('管理员初始化需要持久化数据库；内存演示请使用管理员 API Token 创建账号。');
if (!process.stdin.isTTY) throw new Error('请在交互式终端运行，密码不会通过参数或日志传递。');
let hidden = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!hidden) process.stdout.write(chunk);
    callback();
  },
});
const input = createInterface({ input: process.stdin, output, terminal: true });
let pool: pg.Pool | undefined;
try {
  const tenantId = identityIdSchema.parse(
    await input.question('租户 ID（迁移时填写原 tenantId）：'),
  );
  const userId = identityIdSchema.parse(await input.question('用户 ID（迁移时填写原 userId）：'));
  const displayName = await input.question('显示名称：');
  process.stdout.write('密码（12–128 字符，输入隐藏）：');
  hidden = true;
  const password = await input.question('');
  process.stdout.write('\n再次输入密码：');
  const confirmation = await input.question('');
  hidden = false;
  process.stdout.write('\n');
  if (password !== confirmation) throw new Error('两次密码不一致。');
  const member = createMemberSchema.safeParse({
    userId,
    displayName,
    role: 'tenant-admin',
    password,
  });
  if (!member.success) throw new Error('账号格式不正确，或密码不足 12 字符。');
  pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  const store = new PostgresIdentityStore(drizzle(pool, { schema }));
  if (
    !(await store.create({
      tenantId,
      userId,
      displayName: member.data.displayName,
      role: 'tenant-admin',
      active: true,
      version: 0,
      createdAt: new Date().toISOString(),
      passwordHash: await hashPassword(password),
    }))
  )
    throw new Error('账号已存在，未覆盖。请由现有管理员重置密码。');
  process.stdout.write('管理员已创建，请打开 /admin/ 登录。\n');
} catch {
  process.stderr.write(
    '\n创建失败：请检查输入、数据库迁移及账号是否已存在。未输出密码或数据库连接信息。\n',
  );
  process.exitCode = 1;
} finally {
  input.close();
  await pool?.end();
}
