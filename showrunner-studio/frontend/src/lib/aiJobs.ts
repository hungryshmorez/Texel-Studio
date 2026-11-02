// aiJobs.ts — run a backend AI job: POST the request, then poll until it finishes.

export interface AiJobOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
  });

/** FastAPI errors are {detail: "text"} or, for validation, {detail: [...]}. Turn either into a sentence. */
export async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  if (typeof body?.detail === "string") return body.detail;
  if (response.status === 422) return "That request was not valid. A field may be too long.";
  return `The studio server returned an error (${response.status}).`;
}

export async function runAiJob<T>(startPath: string, body: unknown, options: AiJobOptions = {}): Promise<T> {
  const { intervalMs = 1500, timeoutMs = 240_000, signal, fetchImpl = fetch } = options;
  const started = await fetchImpl(startPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!started.ok) throw new Error(await errorMessage(started));
  const { job_id: jobId } = (await started.json()) as { job_id: string };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await wait(intervalMs, signal);
    const response = await fetchImpl(`/api/ai/status/${jobId}`, { signal });
    if (!response.ok) throw new Error(await errorMessage(response));
    const job = (await response.json()) as { status: "pending" | "done" | "error"; result: { data: T } | null; error: string | null };
    if (job.status === "error") throw new Error(job.error || "The AI job failed.");
    if (job.status === "done") {
      if (!job.result) throw new Error("The AI job finished without a result.");
      return job.result.data;
    }
  }
  throw new Error("The AI took too long. Try again in a moment.");
}
