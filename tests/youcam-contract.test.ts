import assert from "node:assert/strict";
import test from "node:test";
import { createClothesTask, uploadPhoto, youcamRequest } from "../lib/youcam/client.ts";

process.env.YOUCAM_API_KEY = "test-api-key";
process.env.YOUCAM_API_BASE = "https://provider.test";

test("photo registration uses Bearer but the signed PUT does not", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://provider.test/s2s/v2.0/file/cloth-v3") {
      return Response.json({
        data: {
          files: [{
            file_id: "source-file-id",
            requests: [{
              url: "https://uploads.test/signed",
              headers: { "Content-Type": "image/jpg", "Content-Length": "3" },
            }],
          }],
        },
      });
    }
    return new Response(null, { status: 200 });
  };

  assert.equal(await uploadPhoto(Buffer.from([1, 2, 3]), "photo.jpg", mockFetch as typeof fetch), "source-file-id");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer test-api-key");
  assert.equal(new Headers(calls[1].init?.headers).has("authorization"), false);
  assert.equal(calls[1].init?.method, "PUT");
});

test("task creation uses cloth-v3 and a fixed full-body category", async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(input), init };
    return Response.json({ data: { task_id: "provider-task-id" } });
  };
  const taskId = await createClothesTask("source", "https://assets.test/garment.jpg", mockFetch as typeof fetch);
  assert.equal(taskId, "provider-task-id");
  assert.equal(captured.url, "https://provider.test/s2s/v2.0/task/cloth-v3");
  assert.deepEqual(JSON.parse(String(captured.init?.body)), {
    src_file_id: "source",
    ref_file_url: "https://assets.test/garment.jpg",
    garment_category: "full_body",
  });
});

test("429 responses use bounded retry", async () => {
  let attempts = 0;
  const response = await youcamRequest("/retry", {}, {
    fetchFn: (async () => {
      attempts += 1;
      return attempts === 1 ? new Response(null, { status: 429 }) : Response.json({ ok: true });
    }) as typeof fetch,
    sleep: async () => undefined,
  });
  assert.equal(response.ok, true);
  assert.equal(attempts, 2);
});
