import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPhotoService, photoPath, type PhotoResult, type PhotoService } from './photos.ts';
import { createTaskService, type TaskService } from './tasks.ts';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from './testing.ts';

let pg: PGlite;
let photos: PhotoService;
let tasks: TaskService;
let f: Fixture;
let taskId: string;

beforeAll(async () => {
  pg = await createTestDb();
  const db = new PgliteDbClient(pg);
  photos = createPhotoService(db);
  tasks = createTaskService(db);
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  f = await createFixture(pg);
  const created = await tasks.createTask({
    householdId: f.householdId,
    actorMemberId: f.ownerId,
    title: 'Montar o armário',
  });
  taskId = created.ok ? created.task.id : '';
});

function add(over: Partial<Parameters<PhotoService['addPhoto']>[0]> = {}) {
  return photos.addPhoto({
    householdId: f.householdId,
    actorMemberId: f.memberId,
    taskId,
    photoId: crypto.randomUUID(),
    contentType: 'image/jpeg',
    sizeBytes: 1234,
    ...over,
  });
}

function okPhoto(r: PhotoResult) {
  if (!r.ok) throw new Error(`esperava ok, veio ${r.error}`);
  return r;
}

async function countPhotos() {
  const res = await pg.query<{ n: number }>(
    'select count(*)::int as n from task_photos where task_id = $1',
    [taskId],
  );
  return res.rows[0]?.n;
}

describe('fotos', () => {
  it('anexa a foto, registra autor e conta na tarefa', async () => {
    const photoId = crypto.randomUUID();
    const r = okPhoto(await add({ photoId, caption: '  Prova documental  ' }));
    expect(r.event).toBe('photo_added');
    expect(r.photo).toMatchObject({
      id: photoId,
      storage_path: photoPath(f.householdId, taskId, photoId, 'image/jpeg'),
      caption: 'Prova documental',
      uploaded_by_member_id: f.memberId,
    });
    expect(r.task.photo_count).toBe(1);

    const details = await tasks.getTask({ householdId: f.householdId, taskId });
    expect(details.photos?.map((p) => p.id)).toEqual([photoId]);
  });

  it('não anexa a tarefa de outra casa', async () => {
    const r = await photos.addPhoto({
      householdId: f.otherHouseholdId,
      actorMemberId: f.outsiderId,
      taskId,
      photoId: crypto.randomUUID(),
      contentType: 'image/png',
      sizeBytes: 10,
    });
    expect(r).toEqual({ ok: false, error: 'task_not_found' });
    expect(await countPhotos()).toBe(0);
  });

  it('recusa membro inativo ou de outra casa', async () => {
    await expect(add({ actorMemberId: f.inactiveMemberId })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(add({ actorMemberId: f.outsiderId })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('o banco recusa caminho fora da pasta da casa/tarefa', async () => {
    await expect(
      pg.query(`select add_task_photo($1, $2, $3, $4, $5, 'image/jpeg', 10)`, [
        f.householdId,
        f.ownerId,
        taskId,
        crypto.randomUUID(),
        `${f.otherHouseholdId}/x.jpg`,
      ]),
    ).rejects.toThrow(/invalid_input/);
  });

  it('limita a 10 fotos por tarefa', async () => {
    for (let i = 0; i < 10; i++) okPhoto(await add());
    expect(await add()).toMatchObject({ ok: false, error: 'photo_limit' });
  });

  it('repetir o mesmo envio não duplica', async () => {
    const input = { photoId: crypto.randomUUID(), idempotencyKey: `web:${crypto.randomUUID()}` };
    const first = okPhoto(await add(input));
    const replay = await add({ ...input, photoId: crypto.randomUUID() });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await countPhotos()).toBe(1);
  });

  it('remove logicamente, some da tarefa e mantém quem removeu', async () => {
    const { photo } = okPhoto(await add());
    const removed = okPhoto(
      await photos.deletePhoto({
        householdId: f.householdId,
        actorMemberId: f.ownerId,
        photoId: photo.id,
      }),
    );
    expect(removed).toMatchObject({ event: 'photo_removed', task: { photo_count: 0 } });
    expect(removed.photo.storage_path).toBe(photo.storage_path);

    const again = await photos.deletePhoto({
      householdId: f.householdId,
      actorMemberId: f.ownerId,
      photoId: photo.id,
    });
    expect(again).toMatchObject({ ok: true, event: 'photo_already_removed' });

    const details = await tasks.getTask({ householdId: f.householdId, taskId });
    expect(details.photos).toEqual([]);
    const row = await pg.query<{ deleted_by_member_id: string }>(
      'select deleted_by_member_id from task_photos where id = $1',
      [photo.id],
    );
    expect(row.rows[0]?.deleted_by_member_id).toBe(f.ownerId);
  });

  it('não remove foto de outra casa', async () => {
    const { photo } = okPhoto(await add());
    expect(
      await photos.deletePhoto({
        householdId: f.otherHouseholdId,
        actorMemberId: f.outsiderId,
        photoId: photo.id,
      }),
    ).toEqual({ ok: false, error: 'photo_not_found' });
  });

  it('valida tipo e tamanho antes de chamar o banco', async () => {
    await expect(add({ contentType: 'image/gif' as 'image/png' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(add({ sizeBytes: 20_000_000 })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
