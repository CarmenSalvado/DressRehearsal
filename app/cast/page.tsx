"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

type Garment = {
  id: string;
  name: string;
  rental: string;
  image: string;
};

type Task = {
  garmentId: string;
  state: "queued" | "uploading" | "processing" | "live" | "failed";
  provenance: "live" | "failed" | null;
  elapsedMs: number;
  resultUrl: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
};

type CastingSession = {
  sessionId: string;
  state: string;
  expiresAt: string;
  selectedGarmentId: string | null;
  fittingIntentRecorded: boolean;
  garments: Garment[];
  tasks: Task[];
};

type Phase = "access" | "portrait" | "reveal";

class RequestError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new RequestError(payload?.error?.code ?? "request_failed", payload?.error?.message ?? "The request could not be completed.");
  }
  return payload as T;
}

const statusCopy: Record<Task["state"], string> = {
  queued: "Waiting in the wings",
  uploading: "Entering the stage",
  processing: "Under the lights",
  live: "Live result",
  failed: "Could not be cast",
};

export default function CastPage() {
  const [phase, setPhase] = useState<Phase>("access");
  const [session, setSession] = useState<CastingSession | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [consent, setConsent] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const terminal = Boolean(session?.tasks.length) && session!.tasks.every((task) => task.state === "live" || task.state === "failed");

  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (phase !== "reveal" || !session || terminal) return;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const updated = await api<CastingSession>(`/api/sessions/${session.sessionId}`);
        if (!cancelled) {
          setSession(updated);
          setError("");
        }
      } catch (reason) {
        if (!cancelled) {
          if (reason instanceof RequestError && reason.code === "access_required") setPhase("access");
          setError(messageFor(reason));
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 3000);
    };

    timer = window.setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, session?.sessionId, terminal]);

  async function enterStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("access");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: form.get("code") }),
      });

      const savedId = localStorage.getItem("dress-rehearsal-session");
      if (savedId) {
        try {
          const saved = await api<CastingSession>(`/api/sessions/${savedId}`);
          setSession(saved);
          setPhase(saved.tasks.length ? "reveal" : "portrait");
          return;
        } catch (reason) {
          if (!(reason instanceof RequestError) || reason.code !== "session_not_found") throw reason;
          localStorage.removeItem("dress-rehearsal-session");
        }
      }
      setPhase("portrait");
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy("");
    }
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError("");
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1024 * 1024 || file.size > 10 * 1024 * 1024)) {
      event.target.value = "";
      setPhoto(null);
      setError("Choose a JPEG, PNG or WebP image between 1 MB and 10 MB.");
      return;
    }
    setPhoto(file);
  }

  async function startCasting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!session || session.state === "created") && !photo) {
      setError("Choose a full-body photograph first.");
      return;
    }

    setBusy("casting");
    setError("");
    try {
      let current = session;
      if (!current) {
        current = await api<CastingSession>("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent, rightsConfirmed, scene: "main-stage" }),
        });
        setSession(current);
        localStorage.setItem("dress-rehearsal-session", current.sessionId);
      }

      if (current.state === "created") {
        const form = new FormData();
        form.set("photo", photo!);
        await api(`/api/sessions/${current.sessionId}/photo`, { method: "POST", body: form });
        current = { ...current, state: "uploaded" };
        setSession(current);
      }

      if (current.state === "uploaded") {
        current = await api<CastingSession>(`/api/sessions/${current.sessionId}/start`, {
          method: "POST",
          headers: { "Idempotency-Key": `casting:${current.sessionId}` },
        });
      }

      setSession(current);
      setPhase("reveal");
    } catch (reason) {
      if (reason instanceof RequestError && reason.code === "access_required") setPhase("access");
      setError(messageFor(reason));
    } finally {
      setBusy("");
    }
  }

  async function selectLook(garmentId: string) {
    if (!session) return;
    setBusy(`select:${garmentId}`);
    setError("");
    try {
      await api(`/api/sessions/${session.sessionId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ garmentId }),
      });
      setSession({ ...session, state: "selected", selectedGarmentId: garmentId });
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy("");
    }
  }

  async function retryLook(garmentId: string) {
    if (!session) return;
    setBusy(`retry:${garmentId}`);
    setError("");
    try {
      const updated = await api<CastingSession>(`/api/sessions/${session.sessionId}/tasks/${garmentId}/retry`, { method: "POST" });
      setSession(updated);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy("");
    }
  }

  async function reserveFitting() {
    if (!session) return;
    setBusy("reserve");
    setError("");
    try {
      await api(`/api/sessions/${session.sessionId}/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "reserve_fitting" }),
      });
      setSession({ ...session, fittingIntentRecorded: true });
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy("");
    }
  }

  async function endCasting() {
    if (!session || !window.confirm("End this casting and remove its local record?")) return;
    setBusy("delete");
    setError("");
    try {
      await api(`/api/sessions/${session.sessionId}`, { method: "DELETE" });
      localStorage.removeItem("dress-rehearsal-session");
      setSession(null);
      setPhoto(null);
      setConsent(false);
      setRightsConfirmed(false);
      setPhase("portrait");
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="cast-shell">
      <header className="cast-header">
        <Link className="wordmark" href="/" aria-label="Dress Rehearsal home">
          <span className="monogram" aria-hidden="true">DR</span>
          <span>Dress Rehearsal</span>
        </Link>
        <p><span aria-hidden="true" /> Main stage · Casting room</p>
      </header>

      <nav className="cast-steps" aria-label="Casting progress">
        {(["access", "portrait", "reveal"] as Phase[]).map((step, index) => (
          <span key={step} className={phase === step ? "is-current" : index < ["access", "portrait", "reveal"].indexOf(phase) ? "is-done" : ""}>
            <b>0{index + 1}</b> {step === "access" ? "Invitation" : step === "portrait" ? "Portrait" : "The reveal"}
          </span>
        ))}
      </nav>

      {phase === "access" && (
        <section className="cast-gate enter" aria-labelledby="access-title">
          <div className="gate-copy">
            <p className="eyebrow">Private preview · Admit one</p>
            <h1 id="access-title">Your fitting room is <em>ready.</em></h1>
            <p>Enter the invitation code to begin a private, time-limited virtual casting.</p>
          </div>
          <form className="access-ticket" onSubmit={enterStage}>
            <p>Dress Rehearsal</p>
            <div>
              <label htmlFor="access-code">Invitation code</label>
              <input id="access-code" name="code" type="password" autoComplete="one-time-code" required autoFocus />
            </div>
            <button className="cast-action" disabled={Boolean(busy)}>
              {busy === "access" ? "Checking invitation…" : "Enter the main stage"}
              <span aria-hidden="true">→</span>
            </button>
            <small>Access expires after two hours.</small>
          </form>
        </section>
      )}

      {phase === "portrait" && (
        <section className="portrait-stage enter" aria-labelledby="portrait-title">
          <div className="portrait-intro">
            <p className="eyebrow">Act I · Your portrait</p>
            <h1 id="portrait-title">Give the clothes a clear <em>canvas.</em></h1>
            <p>A single, front-facing photograph creates all three previews.</p>
          </div>

          <form className="portrait-form" onSubmit={startCasting}>
            <label className={`photo-drop ${preview ? "has-photo" : ""}`} htmlFor="photo">
              {preview ? (
                // A blob URL cannot be rendered by next/image.
                <img src={preview} alt="Selected portrait preview" />
              ) : session?.state === "uploaded" ? (
                <span><b>Portrait received</b><small>Ready to continue casting</small></span>
              ) : (
                <span><b>Choose your portrait</b><small>JPEG, PNG or WebP · 1–10 MB</small></span>
              )}
              {session?.state !== "uploaded" && <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} />}
              <i aria-hidden="true">+</i>
            </label>

            <div className="portrait-controls">
              <div className="photo-notes" aria-label="Photo guidance">
                <p><span>01</span><b>Face the camera</b><small>Stand naturally with your full body visible.</small></p>
                <p><span>02</span><b>Use even light</b><small>Avoid shadows, mirrors and other people.</small></p>
                <p><span>03</span><b>Wear a simple base</b><small>Fitted clothing gives the clearest preview.</small></p>
              </div>

              <label className="cast-check">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
                <span>I consent to Perfect Corp processing this photograph to create virtual clothing previews.</span>
              </label>
              <label className="cast-check">
                <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} required />
                <span>I own this photograph or have permission to use it.</span>
              </label>

              <button className="cast-action" disabled={Boolean(busy)}>
                {busy === "casting" ? "Preparing three looks…" : session?.state === "uploaded" ? "Continue casting" : "Cast all three looks"}
                <span aria-hidden="true">→</span>
              </button>
              <p className="privacy-note">The original is normalized in memory and is not stored by this application.</p>
            </div>
          </form>
        </section>
      )}

      {phase === "reveal" && session && (
        <section className="reveal-stage enter" aria-labelledby="reveal-title">
          <div className="reveal-heading">
            <div>
              <p className="eyebrow">Act II · The reveal</p>
              <h1 id="reveal-title">Three entrances. <em>One choice.</em></h1>
            </div>
            <p>{terminal ? "The casting is complete. Choose the look you want to meet in person." : "Your looks appear one by one as YouCam finishes each live run."}</p>
          </div>

          <div className="look-grid" aria-live="polite" aria-busy={!terminal}>
            {session.garments.map((garment, index) => {
              const task = session.tasks.find((item) => item.garmentId === garment.id);
              const selected = session.selectedGarmentId === garment.id;
              return (
                <article className={`look-card ${selected ? "is-selected" : ""}`} key={garment.id}>
                  <div className="look-image">
                    <img src={task?.resultUrl ?? garment.image} alt={task?.resultUrl ? `${garment.name} virtual try-on result` : garment.name} />
                    {task && task.state !== "live" && <div className={`look-state state-${task.state}`}><span aria-hidden="true" />{statusCopy[task.state]}</div>}
                    {!task && <div className="look-state"><span aria-hidden="true" />Waiting in the wings</div>}
                    {task?.state === "live" && <span className="proof-mark">Live · YouCam cloth-v3</span>}
                    <span className="look-number">0{index + 1}</span>
                  </div>
                  <div className="look-meta">
                    <div><h2>{garment.name}</h2><p>{garment.rental}</p></div>
                    {task?.state === "live" && (
                      <button className="select-look" aria-pressed={selected} disabled={Boolean(busy)} onClick={() => !selected && selectLook(garment.id)}>
                        {selected ? "Selected ✓" : busy === `select:${garment.id}` ? "Selecting…" : "Choose look"}
                      </button>
                    )}
                  </div>
                  {task?.state === "failed" && (
                    <div className="look-error">
                      <p>{task.error?.message}</p>
                      {task.error?.retryable && <button disabled={Boolean(busy)} onClick={() => retryLook(garment.id)}>{busy === `retry:${garment.id}` ? "Retrying…" : "Retry this look"}</button>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {session.selectedGarmentId && (
            <div className="selection-dock">
              <div>
                <p>Your selection</p>
                <strong>{session.garments.find((garment) => garment.id === session.selectedGarmentId)?.name}</strong>
              </div>
              {session.fittingIntentRecorded ? (
                <p className="intent-receipt"><b>Interest recorded.</b> No booking was created.</p>
              ) : (
                <button className="cast-action" disabled={Boolean(busy)} onClick={reserveFitting}>
                  {busy === "reserve" ? "Recording…" : "Request a physical fitting"}<span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          )}

          <button className="end-casting" disabled={Boolean(busy)} onClick={endCasting}>End casting and delete local record</button>
        </section>
      )}

      {error && <p className="cast-error" role="alert">{error}</p>}
    </main>
  );
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "The stage hit an unexpected problem.";
}
