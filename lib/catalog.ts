import { AppError } from "./errors.ts";

const CATALOG = [
  {
    id: "silver-headliner",
    name: "Silver Headliner",
    rental: "€180 · 3 nights",
    env: "GARMENT_SILVER_URL",
  },
  {
    id: "crimson-entrance",
    name: "Crimson Entrance",
    rental: "€210 · 3 nights",
    env: "GARMENT_CRIMSON_URL",
  },
  {
    id: "midnight-icon",
    name: "Midnight Icon",
    rental: "€195 · 3 nights",
    env: "GARMENT_MIDNIGHT_URL",
  },
] as const;

export type GarmentId = (typeof CATALOG)[number]["id"];

export function catalog() {
  return CATALOG.map(({ env, ...garment }) => ({
    ...garment,
    image: `/api/catalog/${garment.id}`,
    configured: Boolean(process.env[env]?.trim()),
  }));
}

export function garmentReferenceUrl(id: string) {
  const garment = CATALOG.find((item) => item.id === id);
  if (!garment) throw new AppError("invalid_garment", "Choose a garment from this casting.");

  const raw = process.env[garment.env]?.trim();
  if (!raw) throw new AppError("not_configured", `${garment.env} is not configured.`, 503);

  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new AppError("not_configured", `${garment.env} must use HTTPS.`, 503);
  }
  return url.toString();
}

export function isGarmentId(value: string): value is GarmentId {
  return CATALOG.some((garment) => garment.id === value);
}

export const garmentIds = CATALOG.map((garment) => garment.id);
