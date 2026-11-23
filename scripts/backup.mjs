// Exporta os dados do Supabase para a pasta local backups/<data>/ (ignorada pelo Git).
// Uso: node scripts/backup.mjs [--photos]
// Lê SUPABASE_URL e SUPABASE_SECRET_KEY do ambiente ou de apps/worker/.dev.vars; nunca os imprime.
/* eslint-disable no-console */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Dados que valem guardar. Ficam de fora: códigos de vinculação (curtos, só hash), o contexto da
// conversa (expira sozinho) e as chaves de idempotência de mensagens.
const TABLES = [
  'households',
  'household_members',
  'task_recurrence_rules',
  'tasks',
  'task_events',
  'task_photos',
];
const PAGE = 1000;
const HEADERS_UA = { 'user-agent': 'camarada-backup/1.0' };

function loadVars() {
  const vars = {};
  try {
    const file = new URL('../apps/worker/.dev.vars', import.meta.url);
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // Sem .dev.vars: usa só o ambiente.
  }
  return { ...vars, ...process.env };
}

const vars = loadVars();
const base = vars.SUPABASE_URL;
const key = vars.SUPABASE_SECRET_KEY;
if (!base || !key) {
  console.error('Defina SUPABASE_URL e SUPABASE_SECRET_KEY (ambiente ou apps/worker/.dev.vars).');
  process.exit(1);
}
const auth = { ...HEADERS_UA, apikey: key, authorization: `Bearer ${key}` };

async function fetchTable(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${base}/rest/v1/${table}?select=*&order=created_at.asc,id.asc`, {
      headers: { ...auth, range: `${from}-${from + PAGE - 1}`, 'range-unit': 'items' },
    });
    if (!res.ok) {
      throw new Error(`Falha ao ler ${table}: HTTP ${res.status}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = new URL(`../backups/${stamp}/`, import.meta.url);
mkdirSync(dir, { recursive: true });

const counts = {};
let photos = [];
for (const table of TABLES) {
  const rows = await fetchTable(table);
  counts[table] = rows.length;
  if (table === 'task_photos') photos = rows;
  writeFileSync(new URL(`${table}.json`, dir), JSON.stringify(rows, null, 2));
}

if (process.argv.includes('--photos')) {
  const photoDir = new URL('photos/', dir);
  let saved = 0;
  for (const photo of photos.filter((p) => !p.deleted_at)) {
    const res = await fetch(`${base}/storage/v1/object/task-photos/${photo.storage_path}`, {
      headers: auth,
    });
    if (!res.ok) {
      console.error(`Foto ${photo.id}: HTTP ${res.status}`);
      continue;
    }
    const file = new URL(photo.storage_path, photoDir);
    mkdirSync(new URL('./', file), { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    saved += 1;
  }
  counts.photos_files = saved;
}

console.log(`Backup em backups/${stamp}/`);
console.table(counts);
