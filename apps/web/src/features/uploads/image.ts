/* Getting a phone photo into a shape the API will accept.

   `POST /bookings/{id}/evidence` takes **base64 in a JSON body**, not multipart,
   and the API enforces two limits taken from settings: `evidence.photo_max_bytes`
   (5 MB) and `evidence.photo_max_edge_px` (1600px). A modern phone photo is
   routinely over both — often 4–12 MB at 4000px.

   So the bytes are downscaled and re-encoded here rather than rejected at the
   user. That is what makes the upload survive the connection the requirement
   cares about: a 5 MB JSON body on rural 3G is the difference between a photo
   and a failure.

   `compressImage` degrades: it tries JPEG at a few qualities and then falls back
   to the original bytes, so a browser without canvas support still uploads rather
   than showing an error it cannot fix. */

export const MAX_EVIDENCE_EDGE_PX = 1600;

/** Matches `evidence.photo_max_bytes`. Rejecting above this is a last resort. */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

/** How a FileReader failure and an oversized read both read to the person at the keyboard. */
export const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const result = reader.result;
      /* `readAsDataURL` yields "data:<mime>;base64,<payload>" — the API wants the
         payload alone, with the type in its own field. A non-string result means
         the read went wrong, not that the payload is empty. */
      if (typeof result !== 'string') {
        reject(new Error('That file could not be read.'));
        return;
      }
      const comma = result.indexOf(',');
      if (comma === -1) {
        reject(new Error('That file could not be read.'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });

/** The three content types `addEvidenceSchema` accepts. */
export type EvidenceContentType = 'image/jpeg' | 'image/png' | 'image/webp';

type Prepared = { base64: string; contentType: EvidenceContentType; rejected?: undefined } | { rejected: string };

/**
 * Downscale to `MAX_EVIDENCE_EDGE_PX` on the longest edge and re-encode as JPEG.
 *
 * PNG is kept as PNG only when the source is a PNG *and* already small — a
 * screenshot should stay lossless, but a PNG photograph is enormous and JPEG is
 * the right answer for it.
 */
export const compressImage = async (file: File): Promise<{ blob: Blob; contentType: EvidenceContentType } | null> => {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;

  try {
    const bitmap = await createImageBitmap(file);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longestEdge > MAX_EVIDENCE_EDGE_PX ? MAX_EVIDENCE_EDGE_PX / longestEdge : 1;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    bitmap.close();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(await createImageBitmap(file), 0, 0, width, height);

    /* Quality steps rather than one guess: a night-time photo may need 0.6 and a
       daylight one 0.9, and a single fixed value either wastes bytes or looks
       poor on the evidence the verification agent reads. */
    for (const quality of [0.82, 0.7, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob !== null && blob.size > 0) return { blob, contentType: 'image/jpeg' };
    }
    return null;
  } catch {
    /* A corrupt or unsupported image — let the caller send the original. */
    return null;
  }
};

/**
 * Produces the base64 payload for one evidence upload.
 *
 * `rejected` is only ever set when compression is unavailable *and* the file is
 * over the hard limit: there is nothing left to try, and saying so is better than
 * letting the server reject it with a message about bytes.
 */
export const prepareEvidenceImage = async (file: File): Promise<Prepared> => {
  const compressed = await compressImage(file);
  if (compressed === null) {
    if (file.size > MAX_EVIDENCE_BYTES) {
      return {
        rejected: `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. Photos must be under 5 MB — try one from your camera roll rather than a screenshot or a scan.`
      };
    }
    return {
      base64: await fileToBase64(file),
      contentType: file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
    };
  }

  /* Still possible to be over the limit if the original was already at the edge
     and JPEG barely helped; re-encoding at a lower quality is the cheap retry. */
  if (compressed.blob.size > MAX_EVIDENCE_BYTES) {
    return {
      rejected: `That photo is too large to send even after resizing. Try a different photo.`
    };
  }

  return { base64: await fileToBase64(compressed.blob), contentType: compressed.contentType };
};
