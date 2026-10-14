import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { settingGroups, type SettingField } from './settings-schema';

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Private configuration key unavailable');
  return createHash('sha256').update(secret).digest();
}
export function encryptConfig(value: unknown) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
export function decryptConfig<T>(value: string): T {
  const raw = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), raw.subarray(0,12));
  decipher.setAuthTag(raw.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString());
}
function configPath(name: string) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(name)) throw new Error('Invalid config name');
  return path.join(process.cwd(), '.runtime', 'connections', `${name}.enc`);
}
export async function readPrivate<T>(name: string, fallback: T): Promise<T> {
  try { return decryptConfig<T>(await fs.readFile(configPath(name), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
export async function writePrivate(name: string, value: unknown) {
  const file = configPath(name); await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomBytes(8).toString('hex');
  await fs.writeFile(temporary, encryptConfig(value), { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, file);
}
export async function platformConfig(): Promise<Record<string,string>> {
  const values: Record<string,string> = {};
  for (const group of Object.values(settingGroups)) for (const field of group.fields) values[field.key] = process.env[field.key] || '';
  if (!values.GEMINI_API_KEY) {
    try { values.GEMINI_API_KEY = (await fs.readFile(path.join(process.env.CITAVEL_ENGINE_PATH || '/Users/pedro/Documents/CITAVEL/citavel-engine','.runtime','gemini.key'),'utf8')).trim(); } catch { /* optional existing Engine credential */ }
  }
  return { ...values, ...await readPrivate<Record<string,string>>('platform', {}) };
}
export async function publicSettings() {
  const values = await platformConfig();
  return Object.entries(settingGroups).map(([key,group]) => ({ key, label: group.label, fields: (group.fields as SettingField[]).map(field => ({ ...field, value: field.secret ? '' : values[field.key] || '', configured: Boolean(values[field.key]) })) }));
}
let queue = Promise.resolve();
export function savePlatform(values: Record<string,string>) {
  const task = queue.then(async () => {
    const previous = await readPrivate<Record<string,string>>('platform', {});
    await writePrivate('platform', { ...previous, ...values });
    for (const [key,value] of Object.entries(values)) process.env[key] = value;
  });
  queue = task.catch(() => {}); return task;
}
