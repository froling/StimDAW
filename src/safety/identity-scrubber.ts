/**
 * Identity scrubber — filtrerar ut absolute paths och usernames ur strängar och
 * objekt INNAN de hamnar i .stimdaw-filer eller exporterade logs.
 *
 * Per outside-voice finding #14: solo + public code + private identity-policy.
 * Ingen machine-path eller username får läcka i committed/exported artefakter.
 *
 * Vad som scrubbar:
 * - Mac/Linux home: /Users/<user> /home/<user> → <HOME>
 * - Windows home: C:\Users\<user> → <HOME>
 * - Windows env: %USERPROFILE%, %USERNAME% style → <HOME>
 *
 * Vad scrubbas INTE:
 * - Email-adresser (separat policy om vi någonsin använder)
 * - IP-adresser (lokala saknar identitet)
 * - .stimdaw-content (custom user data — ej path)
 */

const PATTERNS: Array<[RegExp, string]> = [
  // Windows: C:\Users\name\..., D:\Users\name\..., etc.
  [/[A-Za-z]:\\Users\\[^\\\/]+/g, '<HOME>'],
  // Windows forward-slash form
  [/[A-Za-z]:\/Users\/[^\\\/]+/g, '<HOME>'],
  // macOS
  [/\/Users\/[^\/\s]+/g, '<HOME>'],
  // Linux
  [/\/home\/[^\/\s]+/g, '<HOME>'],
  // env-var refs
  [/%USERPROFILE%/g, '<HOME>'],
  [/%USERNAME%/g, '<USER>'],
  [/\$HOME(?=[\\\/])/g, '<HOME>'],
];

export function scrubIdentity(text: string): string {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Deep-walk and scrub all string fields. Arrays and objects walked. */
export function scrubObject<T>(value: T): T {
  if (typeof value === 'string') return scrubIdentity(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubObject(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = scrubObject(v);
    }
    return result as T;
  }
  return value;
}
