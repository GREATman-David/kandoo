/**
 * Checks on a photo sent by the phone, kept free of any database import so
 * they can be tested on their own.
 */

/** The bucket's own ceiling is 5 MB; the phone sends ~200–600 KB. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export class PhotoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoInputError';
  }
}

/**
 * Decode and check a base64 JPEG from the phone. The app re-encodes every
 * photo as JPEG (which also drops its EXIF location), so anything else is
 * refused rather than stored.
 */
export function decodeJpeg(base64: unknown): Buffer {
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new PhotoInputError('A photo is required.');
  }
  // Rough size check before decoding: base64 is 4/3 the bytes.
  if (base64.length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4) {
    throw new PhotoInputError('That photo is too large.');
  }
  const bytes = Buffer.from(base64, 'base64');
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isJpeg) throw new PhotoInputError('That photo couldn’t be read.');
  if (bytes.length > MAX_PHOTO_BYTES) throw new PhotoInputError('That photo is too large.');
  return bytes;
}
