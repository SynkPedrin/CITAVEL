// Outbound fetching for brand assets, hardened against SSRF: every hop (initial URL and each redirect) is resolved
// by DNS and rejected if ANY resolved address is private, loopback, link-local, metadata or otherwise non-public.
// The connection is then made to the validated address, so DNS cannot change between check and use.
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { HttpError } from '../security';

export const FETCH_LIMITS = { timeoutMs: 8000, maxRedirects: 3, maxHtmlBytes: 1_500_000, maxImageBytes: 1_000_000 };

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && ip.startsWith('192.0.0.')) )) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false; // multicast + reserved
    return true;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return false;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return isPublicAddress(mapped[1]);
    if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(v)) return false;
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('64:ff9b') || v.startsWith('2001:db8')) return false;
    return true;
  }
  return false;
}

export function parsePublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Endereço inválido.', 'BAD_URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Apenas endereços http e https são permitidos.', 'BAD_URL');
  if (u.username || u.password) throw new HttpError(400, 'Endereço com credenciais não é permitido.', 'BAD_URL');
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (![80, 443].includes(port)) throw new HttpError(400, 'Porta não permitida.', 'BAD_URL');
  if (!u.hostname || u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) throw new HttpError(400, 'Endereço interno não permitido.', 'BLOCKED_ADDRESS');
  return u;
}

export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async host => (await dns.lookup(host, { all: true, verbatim: true })).map(a => a.address);

async function validatedAddress(host: string, resolve: Resolver): Promise<string> {
  const bare = host.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(bare) ? [bare] : await resolve(bare).catch(() => { throw new HttpError(502, 'Domínio não encontrado.', 'DNS_FAILED'); });
  if (!addrs.length) throw new HttpError(502, 'Domínio não encontrado.', 'DNS_FAILED');
  if (!addrs.every(isPublicAddress)) throw new HttpError(400, 'Endereço interno não permitido.', 'BLOCKED_ADDRESS');
  return addrs[0];
}

type Fetched = { url: string; status: number; contentType: string; body: Buffer };

function once(u: URL, address: string, maxBytes: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ host: address, port: u.port || (u.protocol === 'https:' ? 443 : 80), method: 'GET', path: u.pathname + u.search, servername: net.isIP(u.hostname) ? undefined : u.hostname,
      headers: { host: u.host, 'user-agent': 'CitavelBrandResolver/1.0 (+logo lookup)', accept: 'text/html,image/*;q=0.9,*/*;q=0.5', 'accept-encoding': 'identity' }, timeout: FETCH_LIMITS.timeoutMs }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > maxBytes) { req.destroy(new HttpError(413, 'Arquivo grande demais.', 'TOO_LARGE')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new HttpError(504, 'Tempo esgotado ao consultar o site.', 'TIMEOUT')));
    req.on('error', e => reject(e instanceof HttpError ? e : new HttpError(502, 'Não foi possível acessar o endereço.', 'FETCH_FAILED')));
    req.end();
  });
}

export async function safeFetch(rawUrl: string, maxBytes: number, resolve: Resolver = systemResolver): Promise<Fetched> {
  let url = parsePublicUrl(rawUrl);
  for (let hop = 0; hop <= FETCH_LIMITS.maxRedirects; hop++) {
    const address = await validatedAddress(url.hostname, resolve);
    const r = await once(url, address, maxBytes);
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.location; if (!loc) throw new HttpError(502, 'Redirecionamento inválido.', 'BAD_REDIRECT');
      url = parsePublicUrl(new URL(loc, url).toString()); continue;
    }
    return { url: url.toString(), status: r.status, contentType: String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), body: r.body };
  }
  throw new HttpError(502, 'Redirecionamentos demais.', 'TOO_MANY_REDIRECTS');
}
