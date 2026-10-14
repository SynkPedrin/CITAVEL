// Search queries can occasionally carry personal data (health clients: names, phone numbers, CPF, e-mails).
// We mask the reliably detectable patterns at ingestion so raw values are never stored. Person names cannot be
// detected reliably and are therefore not claimed to be removed.
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]'],
  [/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]'],
  [/\b\d{7,}\b/g, '[número]'],
];
export function redactQuery(value: string): { value: string; redacted: boolean } {
  let out = value;
  for (const [re, label] of PATTERNS) out = out.replace(re, label);
  return { value: out, redacted: out !== value };
}
