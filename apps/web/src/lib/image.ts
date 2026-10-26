const MAX_SIDE = 1600;
const QUALITY = 0.82;

/**
 * Reduz e regrava a foto em JPEG no navegador (economiza cota e remove metadados como GPS).
 * Se o navegador não conseguir decodificar, devolve o arquivo original para o servidor validar.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    return blob ?? file;
  } finally {
    bitmap.close();
  }
}
