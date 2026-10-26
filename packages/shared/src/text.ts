export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Normaliza texto livre para comparação por regras: minúsculas, sem acentos,
 * sem pontuação e com espaços simples.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
