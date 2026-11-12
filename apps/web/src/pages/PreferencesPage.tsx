import { useState } from 'react';
import {
  errorText,
  type GuidanceMode,
  type PersonaIntensity,
  type TelegramLink,
} from '../lib/api.ts';
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

      <TelegramSection />

      <p role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

function TelegramSection() {
  const { api, me, refresh } = useApp();
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linked = me.member.telegram_linked;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="card" disabled={busy}>
      <legend>Telegram</legend>
      {linked ? (
        <>
          <p>Seu Telegram está vinculado. Converse com o bot por lá.</p>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void run(async () => {
                await api.unlinkTelegram();
                setLink(null);
                refresh();
              })
            }
          >
            Desvincular
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            Gere um código e envie ao bot no Telegram. O código vale por 15 minutos e só pode ser
            usado uma vez.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void run(async () => setLink(await api.createTelegramLink()))}
          >
            Gerar código
          </button>
          {link && (
            <p role="status">
              Envie ao bot: <strong>/start {link.code}</strong>
              {link.link && (
                <>
                  {' '}
                  ou{' '}
                  <a href={link.link} target="_blank" rel="noreferrer noopener">
                    abra o bot com o código já preenchido
                  </a>
                </>
              )}
              .
            </p>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
