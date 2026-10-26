import { z } from 'zod';
import { DomainError, type DbClient } from './client.ts';
import type { Task } from './tasks.ts';

export const PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
export type PhotoContentType = keyof typeof PHOTO_TYPES;

export interface TaskPhoto {
  id: string;
  task_id: string;
  storage_path: string;
  content_type: PhotoContentType;
  size_bytes: number;
  caption: string | null;
  uploaded_by_member_id: string;
  created_at: string;
}

export type PhotoResult =
  | { ok: true; event: string; task: Task; photo: TaskPhoto; replayed?: boolean }
  | { ok: false; error: string; task?: Task; replayed?: boolean };

const id = z.uuid();
const idempotencyKey = z
  .string()
  .regex(/^(telegram|web|system):\S{1,200}$/)
  .optional();

export const addPhotoSchema = z.object({
  householdId: id,
  actorMemberId: id,
  taskId: id,
  photoId: id,
  contentType: z.enum(Object.keys(PHOTO_TYPES) as [PhotoContentType, ...PhotoContentType[]]),
  sizeBytes: z.number().int().min(1).max(10_485_760),
  caption: z.string().trim().max(200).optional(),
  idempotencyKey,
});

/** Caminho no bucket: "<casa>/<tarefa>/<foto>.<ext>". */
export function photoPath(
  householdId: string,
  taskId: string,
  photoId: string,
  type: PhotoContentType,
) {
  return `${householdId}/${taskId}/${photoId}.${PHOTO_TYPES[type]}`;
}

export function createPhotoService(db: DbClient) {
  return {
    async addPhoto(input: z.input<typeof addPhotoSchema>): Promise<PhotoResult> {
      const parsed = addPhotoSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError('invalid_input', z.prettifyError(parsed.error));
      }
      const p = parsed.data;
      return (await db.call('add_task_photo', {
        p_household_id: p.householdId,
        p_actor_member_id: p.actorMemberId,
        p_task_id: p.taskId,
        p_photo_id: p.photoId,
        p_storage_path: photoPath(p.householdId, p.taskId, p.photoId, p.contentType),
        p_content_type: p.contentType,
        p_size_bytes: p.sizeBytes,
        p_caption: p.caption,
        p_idempotency_key: p.idempotencyKey,
      })) as PhotoResult;
    },

    async deletePhoto(input: {
      householdId: string;
      actorMemberId: string;
      photoId: string;
      idempotencyKey?: string;
    }): Promise<PhotoResult> {
      const parsed = z
        .object({ householdId: id, actorMemberId: id, photoId: id, idempotencyKey })
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError('invalid_input', z.prettifyError(parsed.error));
      }
      const p = parsed.data;
      return (await db.call('delete_task_photo', {
        p_household_id: p.householdId,
        p_actor_member_id: p.actorMemberId,
        p_photo_id: p.photoId,
        p_idempotency_key: p.idempotencyKey,
      })) as PhotoResult;
    },
  };
}

export type PhotoService = ReturnType<typeof createPhotoService>;
