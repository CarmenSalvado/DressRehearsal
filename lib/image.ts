import sharp from "sharp";
import { AppError } from "./errors.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const MIN_BYTES = 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function normalizePhoto(file: File) {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new AppError("invalid_image", "Use a JPEG, PNG, or WebP image.", 400, true);
  }
  if (file.size < MIN_BYTES || file.size > MAX_BYTES) {
    throw new AppError("invalid_image", "Use an image between 1 MB and 10 MB.", 400, true);
  }

  const source = Buffer.from(await file.arrayBuffer());
  try {
    const input = sharp(source, { failOn: "error", limitInputPixels: MAX_PIXELS });
    const metadata = await input.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
      throw new Error("invalid dimensions");
    }

    const data = await input
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    return { data, width: metadata.autoOrient.width, height: metadata.autoOrient.height };
  } catch {
    throw new AppError("invalid_image", "The image could not be decoded safely.", 400, true);
  }
}
