import { catalog } from "../../../lib/catalog";

export const runtime = "nodejs";

export function GET() {
  const garments = catalog();
  const configured = Boolean(
    process.env.YOUCAM_API_KEY
    && process.env.DEMO_ACCESS_CODE
    && (process.env.SESSION_SECRET?.length ?? 0) >= 32
    && garments.every((garment) => garment.configured),
  );

  return Response.json({
    status: configured ? "ready" : "configuration_required",
    provider: "youcam",
    model: "cloth-v3",
    storage: "sqlite",
    configured: {
      apiKey: Boolean(process.env.YOUCAM_API_KEY),
      accessCode: Boolean(process.env.DEMO_ACCESS_CODE),
      sessionSecret: (process.env.SESSION_SECRET?.length ?? 0) >= 32,
      garments: garments.map(({ id, configured: ready }) => ({ id, configured: ready })),
    },
  }, { status: configured ? 200 : 503 });
}
