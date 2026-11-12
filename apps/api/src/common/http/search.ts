/**
 * Escape LIKE/ILIKE wildcards so user search text is matched literally
 * (Prisma `contains` maps to ILIKE '%…%' without escaping; PostgreSQL's default
 * escape character is backslash). Security review LOW-1.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
