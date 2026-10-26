import { describe, expect, it } from 'vitest';
import { DEFAULT_PERSONA_INTENSITY, isPersonaIntensity } from './index.ts';

describe('isPersonaIntensity', () => {
  it.each(['off', 'light', 'full'])('aceita %s', (value) => {
    expect(isPersonaIntensity(value)).toBe(true);
  });

  it.each(['OFF', 'max', '', null, 1])('rejeita %s', (value) => {
    expect(isPersonaIntensity(value)).toBe(false);
  });

  it('usa full como padrão', () => {
    expect(DEFAULT_PERSONA_INTENSITY).toBe('full');
  });
});
