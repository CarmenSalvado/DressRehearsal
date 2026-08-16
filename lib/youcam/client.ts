import { pollIntervalMs, youcamApiKey, youcamBaseUrl } from "../config.ts";

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

export class YouCamError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
  }
}

const wait: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response | undefined, attempt: number) {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(10_000, seconds * 1000);
  }
  return Math.min(8_000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
}

export async function youcamRequest(
  path: string,
  init: RequestInit = {},
  dependencies: { fetchFn?: FetchLike; sleep?: Sleep } = {},
) {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const sleep = dependencies.sleep ?? wait;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchFn(`${youcamBaseUrl()}${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${youcamApiKey()}`,
          Accept: "application/json",
          ...init.headers,
        },
      });
      lastResponse = response;
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) {
        throw new YouCamError("provider_rejected", false);
      }
      if (attempt < 2) await sleep(retryDelay(response, attempt));
    } catch (error) {
      if (error instanceof YouCamError) throw error;
      if (attempt === 2) {
        throw new YouCamError(error instanceof DOMException && error.name === "TimeoutError"
          ? "provider_timeout"
          : "provider_unavailable", true);
      }
      await sleep(retryDelay(undefined, attempt));
    }
  }

  throw new YouCamError(lastResponse?.status === 429 ? "provider_rate_limited" : "provider_unavailable", true);
}

async function responseData(response: Response) {
  const payload = await response.json() as { data?: Record<string, unknown> };
  return payload.data ?? {};
}

export async function uploadPhoto(data: Buffer, filename = "casting-photo.jpg", fetchFn: FetchLike = fetch) {
  const response = await youcamRequest("/s2s/v2.0/file/cloth-v3", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [{ content_type: "image/jpg", file_name: filename, file_size: data.byteLength }],
    }),
  }, { fetchFn });
  const body = await responseData(response);
  const file = (body.files as Array<{
    file_id?: string;
    requests?: Array<{ url?: string; headers?: Record<string, string> }>;
  }> | undefined)?.[0];
  const upload = file?.requests?.[0];
  if (!file?.file_id || !upload?.url || new URL(upload.url).protocol !== "https:") {
    throw new YouCamError("provider_invalid_response", false);
  }

  const uploadResponse = await fetchFn(upload.url, {
    method: "PUT",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": upload.headers?.["Content-Type"] ?? "image/jpg",
      "Content-Length": upload.headers?.["Content-Length"] ?? String(data.byteLength),
    },
    body: new Uint8Array(data),
  });
  if (!uploadResponse.ok) throw new YouCamError("provider_upload_failed", true);
  return file.file_id;
}

export async function createClothesTask(sourceFileId: string, referenceUrl: string, fetchFn: FetchLike = fetch) {
  const response = await youcamRequest("/s2s/v2.0/task/cloth-v3", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      src_file_id: sourceFileId,
      ref_file_url: referenceUrl,
      garment_category: "full_body",
    }),
  }, { fetchFn });
  const body = await responseData(response);
  if (typeof body.task_id !== "string" || !body.task_id) {
    throw new YouCamError("provider_invalid_response", false);
  }
  return body.task_id;
}

export async function pollClothesTask(taskId: string, fetchFn: FetchLike = fetch) {
  const response = await youcamRequest(`/s2s/v2.0/task/cloth-v3/${encodeURIComponent(taskId)}`, {}, { fetchFn });
  const body = await responseData(response) as {
    task_status?: string;
    results?: { url?: string };
    error?: string | { code?: string } | null;
  };

  if (body.task_status === "success") {
    const url = body.results?.url;
    if (!url || new URL(url).protocol !== "https:") throw new YouCamError("provider_invalid_response", false);
    return { state: "success" as const, url };
  }
  if (body.task_status === "error") {
    const providerCode = typeof body.error === "string" ? body.error : body.error?.code;
    return { state: "error" as const, code: mapProviderError(providerCode) };
  }
  return { state: "pending" as const, pollAfterMs: pollIntervalMs() };
}

function mapProviderError(code: string | undefined) {
  if (code === "error_pose" || code === "error_invalid_src") return "invalid_pose";
  if (code === "error_invalid_ref" || code === "error_apply_region_mismatch") return "garment_mismatch";
  if (code === "error_nsfw_content_detected") return "content_rejected";
  if (code === "exceed_max_filesize") return "invalid_image";
  return "provider_rejected";
}
