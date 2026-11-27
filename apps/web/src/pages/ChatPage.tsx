import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorText, outcomeUnknown } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { navigate, useSearch } from '../lib/router.tsx';

interface Message {
  id: number;
  from: 'me' | 'bot';
  text: string;
}

/** Conversa de teste com o assistente. As mensagens ficam só nesta tela (não são gravadas). */
export function ChatPage() {
  const { api, text, refresh } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLLIElement>(null);
  const nextId = useRef(0);
  const autoSent = useRef(false);
  const autoSend = useSearch().get('enviar');

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages]);

  async function sendText(msg: string) {
    const add = (from: Message['from'], body: string) =>
      setMessages((list) => [...list, { id: nextId.current++, from, text: body }]);
    add('me', msg);
    setBusy(true);
    try {
      const r = await api.assistant(msg, crypto.randomUUID());
      add('bot', r.reply);
      if (r.changed) refresh();
    } catch (err) {
      if (outcomeUnknown(err)) {
        add(
          'bot',
          'Não sei se sua mensagem foi processada: a resposta não chegou. Confira as tarefas antes de enviar de novo, para não repetir a ação.',
        );
        refresh();
      } else {
        add('bot', `Não consegui processar a mensagem. ${errorText(err)} Nada foi alterado.`);
      }
    } finally {
      setBusy(false);
    }
  }

  // Atalhos como o da página "Primeiros passos" abrem a conversa já com a mensagem enviada, uma vez.
  useEffect(() => {
    if (!autoSend || autoSent.current) return;
    autoSent.current = true;
    navigate('/conversar', true);
    void sendText(autoSend.slice(0, 1000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const msg = draft.trim();
    if (!msg || busy) return;
    setDraft('');
    await sendText(msg);
  }

  return (
    <section aria-labelledby="chat-title" className="chat">
      <h1 id="chat-title">{text.chatTitle}</h1>
      <p className="muted">{text.chatIntro}</p>
      <ol className="chat-log" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`chat-msg chat-${m.from}`}>
            <span className="sr-only">{m.from === 'me' ? 'Você: ' : 'Resposta: '}</span>
            {m.text}
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" />
      </ol>
      <form className="chat-form" onSubmit={send}>
        <label htmlFor="chat-input" className="sr-only">
          Mensagem
        </label>
        <input
          id="chat-input"
          value={draft}
          maxLength={1000}
          autoComplete="off"
          placeholder="Escreva aqui…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
          Enviar
        </button>
      </form>
    </section>
  );
}
