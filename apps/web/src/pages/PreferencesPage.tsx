import { useState } from 'react';
import {
  errorText,
  type PersonaIntensity,
  type PreferencesInput,
  type TelegramLink,
} from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';

const INTENSITIES: { value: PersonaIntensity; label: string; hint: string }[] = [
  { value: 'full', label: 'Camarada completo', hint: 'Personagem inteiro, com piadas e miados.' },
  { value: 'light', label: 'Modo leve', hint: 'Vocabulário do Camarada, sem exagero.' },
  { value: 'off', label: 'Modo sério', hint: 'Textos diretos, sem piadas.' },
];

type ReminderKey = keyof NonNullable<PreferencesInput['reminders']>;

const hour = (hhmm: string) => (hhmm.endsWith(':00') ? `${Number(hhmm.slice(0, 2))}h` : hhmm);

export function PreferencesPage() {
  const { api, me, text, refresh } = useApp();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { reminders } = me.member;
  const h = me.household;

  const REMINDERS: { key: ReminderKey; checked: boolean; label: string; hint: string }[] = [
    {
      key: 'due',
      checked: reminders.due,
      label: 'No prazo',
      hint: 'na hora do prazo; tarefa só com data avisa às ' + hour(h.quiet_end) + ' do dia.',
    },
    {
      key: 'overdue',
      checked: reminders.overdue,
      label: 'Atrasadas',
      hint:
        `uma vez por dia, às ${hour(h.overdue_reminder_time)}` +
        (h.overdue_reminder_days > 0 ? `, por até ${h.overdue_reminder_days} dias.` : '.'),
    },
    {
      key: 'before24h',
      checked: reminders.before_24h,
      label: '24 h antes',
      hint: 'um dia antes do prazo.',
    },
  ];

  async function save(p: PreferencesInput) {
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

      <fieldset className="card" disabled={busy}>
        <legend>Lembretes no Telegram</legend>
        {!me.member.telegram_linked && (
          <p className="muted">Vincule o Telegram acima para receber os lembretes.</p>
        )}
        {REMINDERS.map((r) => (
          <label key={r.key} className="radio">
            <input
              type="checkbox"
              checked={r.checked}
              onChange={(e) => void save({ reminders: { [r.key]: e.target.checked } })}
            />
            <span>
              <strong>{r.label}</strong>
              <span className="muted"> — {r.hint}</span>
            </span>
          </label>
        ))}
        <p className="muted">
          Silêncio das {hour(h.quiet_start)} às {hour(h.quiet_end)}: nenhum lembrete sai nesse
          horário. Tarefas coletivas lembram as duas pessoas.
        </p>
      </fieldset>

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
