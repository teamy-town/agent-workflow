/**
 * Credential shapes masked before text written by someone else (a file's
 * prose, a tool's reason) is put in a prompt and with it into run logs.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{16,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\b(?:zby|mcp)_[A-Za-z0-9_]{16,}\b/g,
  /\b(Bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
];
export function maskCredentials(text: string): string {
  let out = String(text || '');
  for (const re of CREDENTIAL_PATTERNS) {
    out = out.replace(re, (m, g1) => (typeof g1 === 'string' && /^bearer$/i.test(g1) ? `${g1} [masked]` : '[masked credential]'));
  }
  return out;
}
