// Image validation by CONTENT (never by file name or declared MIME). Raster formats are checked by magic bytes and
// header dimensions. SVG is accepted only if it contains nothing active; it is always shown through <img>/data URI,
// where browsers do not run scripts, and served with a sandboxing CSP.
import { HttpError } from '../security';

export type ImageInfo = { mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml'; ext: 'png' | 'jpg' | 'gif' | 'webp' | 'svg'; width: number | null; height: number | null };
export const MAX_LOGO_BYTES = 500_000;
export const MIN_LOGO_SIDE = 24;

export function sniffImage(buf: Buffer): ImageInfo | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]; if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { mime: 'image/jpeg', ext: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { mime: 'image/jpeg', ext: 'jpg', width: null, height: null };
  }
  if (buf.length > 10 && buf.subarray(0, 6).toString('latin1').match(/^GIF8[79]a$/)) return { mime: 'image/gif', ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length > 30 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    const kind = buf.subarray(12, 16).toString('latin1');
    if (kind === 'VP8X') return { mime: 'image/webp', ext: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { mime: 'image/webp', ext: 'webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8 ') return { mime: 'image/webp', ext: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    return { mime: 'image/webp', ext: 'webp', width: null, height: null };
  }
  const head = buf.subarray(0, Math.min(buf.length, 2048)).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', ext: 'svg', width: null, height: null };
  return null;
}

/** Returns a reason when an SVG carries anything active or external; null when it is static and self-contained. */
export function svgProblem(svg: string): string | null {
  const s = svg.replace(/<!--[\s\S]*?-->/g, '');
  if (/<\s*(script|foreignObject|iframe|object|embed|audio|video|canvas|link|meta|animate|set|use)\b/i.test(s)) return 'contém elementos ativos ou externos';
  if (/\son[a-z]+\s*=/i.test(s)) return 'contém manipuladores de evento';
  if (/(javascript|data\s*:\s*text\/html|vbscript)\s*:/i.test(s)) return 'contém URL perigosa';
  if (/(?:xlink:)?href\s*=\s*["']\s*(?!#)/i.test(s)) return 'referencia recursos externos';
  if (/@import|url\(\s*["']?\s*(?!#|data:image\/(png|jpeg|gif|webp))/i.test(s)) return 'referencia recursos externos';
  if (/<!ENTITY/i.test(s)) return 'contém entidades externas';
  return null;
}

export function validateLogo(buf: Buffer): ImageInfo {
  if (!buf.length) throw new HttpError(400, 'Arquivo vazio.', 'EMPTY_IMAGE');
  if (buf.length > MAX_LOGO_BYTES) throw new HttpError(413, `A logo excede ${Math.round(MAX_LOGO_BYTES / 1000)} KB.`, 'TOO_LARGE');
  const info = sniffImage(buf);
  if (!info) throw new HttpError(400, 'O arquivo não é uma imagem válida (PNG, JPG, GIF, WebP ou SVG estático).', 'NOT_AN_IMAGE');
  if (info.mime === 'image/svg+xml') {
    const problem = svgProblem(buf.toString('utf8')); if (problem) throw new HttpError(400, `SVG rejeitado: ${problem}.`, 'UNSAFE_SVG');
  } else {
    if (info.width == null || info.height == null || info.width < 1 || info.height < 1) throw new HttpError(400, 'Imagem corrompida ou ilegível.', 'CORRUPT_IMAGE');
    if (info.width > 8000 || info.height > 8000) throw new HttpError(400, 'Dimensões da imagem excessivas.', 'TOO_LARGE');
    if (Math.max(info.width, info.height) < MIN_LOGO_SIDE) throw new HttpError(400, 'Imagem pequena demais para ser uma logo.', 'TOO_SMALL');
  }
  return info;
}
