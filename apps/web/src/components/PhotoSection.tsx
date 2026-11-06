import { useRef, useState, type FormEvent } from 'react';
import type { Photo } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { prepareImage } from '../lib/image.ts';
import { formatDateTime } from '@camarada/shared';

const MAX_PHOTOS = 10;

export function PhotoSection({ taskId, photos }: { taskId: string; photos: Photo[] }) {
  const { api, text, tz, memberName, runAction, pending } = useApp();
  const [caption, setCaption] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError('Escolha uma foto.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('O arquivo precisa ser uma imagem.');
      return;
    }
    setError(null);
    setPreparing(true);
    let blob: Blob;
    try {
      blob = await prepareImage(file);
    } finally {
      setPreparing(false);
    }
    await runAction((key) => api.uploadPhoto(taskId, blob, caption, key), 'photo_added', {
      onDone: (r) => {
        if (r.ok) {
          setCaption('');
          if (fileInput.current) fileInput.current.value = '';
        }
      },
    });
  }

  return (
    <>
      {photos.length === 0 ? (
        <p className="muted">{text.noPhotos}</p>
      ) : (
        <ul className="photo-grid">
          {photos.map((p, i) => {
            const label = p.caption ?? `Foto ${i + 1}`;
            return (
              <li key={p.id} className="photo">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    <img src={p.url} alt={label} loading="lazy" />
                  </a>
                ) : (
                  <div className="photo-missing">Imagem indisponível agora.</div>
                )}
                <div className="photo-meta">
                  {p.caption && <strong>{p.caption}</strong>}
                  <span className="muted">
                    {memberName(p.uploaded_by_member_id)}, {formatDateTime(p.created_at, tz)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-link"
                    disabled={pending}
                    aria-label={`Remover ${label}`}
                    onClick={() => {
                      if (!window.confirm(`Remover "${label}"?`)) return;
                      void runAction((key) => api.deletePhoto(p.id, key), 'photo_removed');
                    }}
                  >
                    Remover
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {photos.length < MAX_PHOTOS ? (
        <form className="card photo-form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="photo-file">Foto</label>
            <input
              id="photo-file"
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
            />
          </div>
          <div className="field">
            <label htmlFor="photo-caption">Legenda (opcional)</label>
            <input
              id="photo-caption"
              value={caption}
              maxLength={200}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={pending || preparing}>
            {preparing ? 'Preparando…' : 'Anexar foto'}
          </button>
        </form>
      ) : (
        <p className="muted">Limite de {MAX_PHOTOS} fotos atingido.</p>
      )}
    </>
  );
}
