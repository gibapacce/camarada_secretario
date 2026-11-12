import { useState } from 'react';
import { useApp } from '../lib/app-context.ts';
import { Link } from '../lib/router.tsx';

const TOPICS: { title: string; examples: string[] }[] = [
  {
    title: 'Criar tarefas',
    examples: [
      'Lavar a louça hoje às 20h',
      'Nova tarefa: trocar o filtro, pros dois, urgente',
      'Anota: comprar ração pra Deise',
    ],
  },
  {
    title: 'Ver o que falta',
    examples: [
      'O que falta fazer?',
      'O que está atrasado?',
      'O que vence esta semana?',
      'Quais tarefas estão comigo?',
    ],
  },
  {
    title: 'Concluir e corrigir',
    examples: ['Feito 2', 'Concluí a louça', 'Adiar louça para sexta', 'Desfazer'],
  },
  {
    title: 'Resumo e ajuda',
    examples: ['Resumo', 'Ajuda', 'Modo sério', 'Modo camarada'],
  },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-ghost"
      aria-label={`Copiar: ${value}`}
      onClick={() => void copy()}
    >
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  );
}

/** Exemplos prontos e atalhos para o treino guiado (que acontece na conversa). */
export function GetStartedPage() {
  const { text } = useApp();
  return (
    <section aria-labelledby="start-title">
      <h1 id="start-title">{text.startTitle}</h1>
      <p className="muted">{text.startIntro}</p>

      <div className="card">
        <h2>Treino de 2 minutos</h2>
        <p>
          Cinco passos guiados na conversa: criar, consultar, concluir e ver o resumo. As tarefas do
          treino não aparecem no seu plano de verdade e são apagadas no final.
        </p>
        <div className="actions">
          <Link to="/conversar?enviar=treino" className="btn btn-primary">
            Começar o treino
          </Link>
          <Link to="/conversar?enviar=reiniciar%20treino" className="btn">
            Reiniciar o treino
          </Link>
        </div>
      </div>

      {TOPICS.map((topic) => (
        <div key={topic.title} className="card">
          <h2>{topic.title}</h2>
          <ul className="examples">
            {topic.examples.map((example) => (
              <li key={example}>
                <q>{example}</q>
                <CopyButton value={example} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
