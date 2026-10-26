import { describe, expect, it } from 'vitest';
import { normalizeText } from './text.ts';

describe('normalizeText', () => {
  it('remove acentos e coloca em minúsculas', () => {
    expect(normalizeText('Não SEI usar')).toBe('nao sei usar');
  });

  it('remove pontuação e espaços extras', () => {
    expect(normalizeText('  o que você faz?!  ')).toBe('o que voce faz');
  });

  it('preserva a barra de comandos', () => {
    expect(normalizeText('/Ajuda')).toBe('/ajuda');
  });

  it('remove emojis', () => {
    expect(normalizeText('Concluí a louça ✅🐱')).toBe('conclui a louca');
  });

  it('retorna vazio para texto só com pontuação', () => {
    expect(normalizeText('?!...')).toBe('');
  });
});
