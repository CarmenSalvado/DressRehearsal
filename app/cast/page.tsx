"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

type Garment = {
  id: string;
  name: string;
  targetPriceCents: number;
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
  backingIntentRecorded: boolean;
  willingPriceCents: number | null;
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
  const [willingPrice, setWillingPrice] = useState(200);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const terminal = Boolean(session?.tasks.length) && session!.tasks.every((task) => task.state === "live" || task.state === "failed");

  useEffect(() => {
    const selected = session?.garments.find((garment) => garment.id === session.selectedGarmentId);
    if (selected) setWillingPrice((session?.willingPriceCents ?? selected.targetPriceCents) / 100);
  }, [session?.selectedGarmentId, session?.willingPriceCents]);

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
      setSession({
        ...session,
        state: "selected",
        selectedGarmentId: garmentId,
        backingIntentRecorded: session.selectedGarmentId === garmentId && session.backingIntentRecorded,
        willingPriceCents: session.selectedGarmentId === garmentId ? session.willingPriceCents : null,
      });
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

  async function backDesign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusy("back");
    setError("");
    try {
      await api(`/api/sessions/${session.sessionId}/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "back_design", willingPriceCents: Math.round(willingPrice * 100) }),
      });
      setSession({ ...session, backingIntentRecorded: true, willingPriceCents: Math.round(willingPrice * 100) });
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
      setWillingPrice(200);
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
        <div className="cast-header-route">
          <Link href="/studio">Production room</Link>
          <p><span aria-hidden="true" /> Audience preview · Live</p>
        </div>
      </header>

      <nav className="cast-steps" aria-label="Casting progress">
        {(["access", "portrait", "reveal"] as Phase[]).map((step, index) => (
          <span key={step} className={phase === step ? "is-current" : index < ["access", "portrait", "reveal"].indexOf(phase) ? "is-done" : ""}>
            <b>0{index + 1}</b> {step === "access" ? "Invitation" : step === "portrait" ? "Portrait" : "Verdict"}
          </span>
        ))}
      </nav>

      {phase === "access" && (
        <section className="cast-gate enter" aria-labelledby="access-title">
          <div className="gate-copy">
            <p className="eyebrow">Private audience · First edition</p>
            <h1 id="access-title">Help decide what gets <em>made.</em></h1>
            <p>Three unreleased samples are competing for one production slot. Your verdict is part of the buying decision.</p>
          </div>
          <form className="access-ticket" onSubmit={enterStage}>
            <p>Dress Rehearsal</p>
            <div>
              <label htmlFor="access-code">Invitation code</label>
              <input id="access-code" name="code" type="password" autoComplete="one-time-code" required autoFocus />
            </div>
            <button className="cast-action" disabled={Boolean(busy)}>
              {busy === "access" ? "Checking invitation…" : "Enter the private preview"}
              <span aria-hidden="true">→</span>
            </button>
            <small>One audience member · One demand signal · Two-hour access</small>
          </form>
        </section>
      )}

      {phase === "portrait" && (
        <section className="portrait-stage enter" aria-labelledby="portrait-title">
          <div className="portrait-intro">
            <p className="eyebrow">Act I · A real audience</p>
            <h1 id="portrait-title">Put the samples on <em>you.</em></h1>
            <p>Your front-facing portrait lets three pre-production samples compete on something more useful than a stock model.</p>
          </div>

          <form className="portrait-form" onSubmit={startCasting}>
            <label className={`photo-drop ${preview ? "has-photo" : ""}`} htmlFor="photo">
              {preview ? (
                // A blob URL cannot be rendered by next/image.
                <img src={preview} alt="Selected portrait preview" />
              ) : session?.state === "uploaded" ? (
                <span><b>Portrait received</b><small>Ready to audition the samples</small></span>
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
                {busy === "casting" ? "Preparing three samples…" : session?.state === "uploaded" ? "Continue the audition" : "Audition all three samples"}
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
              <p className="eyebrow">Act II · The verdict</p>
              <h1 id="reveal-title">Three samples. <em>One production slot.</em></h1>
            </div>
            <p>{terminal ? "The audition is complete. Choose the sample you would bring into the collection." : "Each sample appears as YouCam finishes its live run. This is an appearance preview, not a fit claim."}</p>
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
                    <div><h2>{garment.name}</h2><p>Target retail · €{garment.targetPriceCents / 100}</p></div>
                    {task?.state === "live" && (
                      <button className="select-look" aria-pressed={selected} disabled={Boolean(busy)} onClick={() => !selected && selectLook(garment.id)}>
                        {selected ? "Your finalist ✓" : busy === `select:${garment.id}` ? "Selecting…" : "Send to final"}
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
            <form className="selection-dock" onSubmit={backDesign}>
              <div>
                <p>Your production vote</p>
                <strong>{session.garments.find((garment) => garment.id === session.selectedGarmentId)?.name}</strong>
              </div>
              {session.backingIntentRecorded ? (
                <p className="intent-receipt"><b>Demand signal recorded at €{session.willingPriceCents! / 100}.</b> No payment was taken.</p>
              ) : (
                <>
                  <label className="price-signal">
                    <span>Price you would genuinely pay</span>
                    <b>€ <input type="number" min="50" max="1000" step="5" value={willingPrice} onChange={(event) => setWillingPrice(Number(event.target.value))} required /></b>
                  </label>
                  <button className="cast-action" disabled={Boolean(busy)}>
                    {busy === "back" ? "Recording signal…" : "Back this design"}<span aria-hidden="true">→</span>
                  </button>
                </>
              )}
            </form>
          )}

          <button className="end-casting" disabled={Boolean(busy)} onClick={endCasting}>Withdraw and delete my local record</button>
        </section>
      )}

      {error && <p className="cast-error" role="alert">{error}</p>}
    </main>
  );
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "The stage hit an unexpected problem.";
}
