import { useState } from 'react';
import { errorText, type GuidanceMode, type PersonaIntensity } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';

const INTENSITIES: { value: PersonaIntensity; label: string; hint: string }[] = [
  { value: 'full', label: 'Camarada completo', hint: 'Personagem inteiro, com piadas e miados.' },
  { value: 'light', label: 'Modo leve', hint: 'Vocabulário do Camarada, sem exagero.' },
  { value: 'off', label: 'Modo sério', hint: 'Textos diretos, sem piadas.' },
];

export function PreferencesPage() {
  const { api, me, text, refresh } = useApp();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(p: { personaIntensity?: PersonaIntensity; guidanceMode?: GuidanceMode }) {
    setBusy(true);
    setStatus(null);
    try {
      await api.updatePreferences(p);
      setStatus('Preferência salva.');
      refresh();
    } catch (e) {
      setStatus(`${errorText(e)} Nada foi alterado.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="pref-title">
      <h1 id="pref-title">{text.preferencesTitle}</h1>
      <p className="muted">
        Cada pessoa escolhe as suas; vale para o painel e, depois, para o bot.
      </p>

      <fieldset className="card" disabled={busy}>
        <legend>Personalidade</legend>
        {INTENSITIES.map((i) => (
          <label key={i.value} className="radio">
            <input
              type="radio"
              name="intensity"
              value={i.value}
              checked={me.member.persona_intensity === i.value}
              onChange={() => void save({ personaIntensity: i.value })}
            />
            <span>
              <strong>{i.label}</strong>
              <span className="muted"> — {i.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="card" disabled={busy}>
        <legend>Modo Aprendiz</legend>
        <label className="radio">
          <input
            type="checkbox"
            checked={me.member.guidance_mode === 'guided'}
            onChange={(e) => void save({ guidanceMode: e.target.checked ? 'guided' : 'normal' })}
          />
          <span>
            <strong>Ativado</strong>
            <span className="muted"> — dicas e tutorial guiado no bot.</span>
          </span>
        </label>
      </fieldset>

      <p role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
