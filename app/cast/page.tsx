"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Brand } from "../brand";
import {
  styleLooks,
  styleOccasions,
  stylePalettes,
  stylePriorities,
  styleSilhouettes,
  type StyleProfile,
} from "../../lib/style-profile";

type Garment = {
  id: string;
  name: string;
  targetPriceCents: number | null;
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
  purchaseIntentRecorded: boolean;
  wouldBuyAtTarget: boolean | null;
  garments: Garment[];
  tasks: Task[];
};

type Phase = "access" | "style" | "portrait" | "reveal";

const emptyStyleProfile: StyleProfile = {
  occasion: "",
  silhouette: "",
  palette: "",
  priorities: [],
  lookIds: [],
};

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
  queued: "Getting ready",
  uploading: "Uploading your photo",
  processing: "Trying this look on",
  live: "Ready to choose",
  failed: "This look needs another try",
};

export default function CastPage() {
  const [phase, setPhase] = useState<Phase>("access");
  const [session, setSession] = useState<CastingSession | null>(null);
  const [quizStep, setQuizStep] = useState(0);
  const [styleProfile, setStyleProfile] = useState<StyleProfile>(emptyStyleProfile);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [consent, setConsent] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const terminal = Boolean(session?.tasks.length) && session!.tasks.every((task) => task.state === "live" || task.state === "failed");
  const selectedGarment = session?.garments.find((garment) => garment.id === session.selectedGarmentId);

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
      setQuizStep(0);
      setPhase("style");
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

  function togglePriority(id: string) {
    setStyleProfile((profile) => ({
      ...profile,
      priorities: profile.priorities.includes(id)
        ? profile.priorities.filter((item) => item !== id)
        : profile.priorities.length < 2 ? [...profile.priorities, id] : profile.priorities,
    }));
  }

  function toggleLook(id: string) {
    setStyleProfile((profile) => ({
      ...profile,
      lookIds: profile.lookIds.includes(id)
        ? profile.lookIds.filter((item) => item !== id)
        : profile.lookIds.length < 3 ? [...profile.lookIds, id] : profile.lookIds,
    }));
  }

  const quizReady = quizStep === 0 ? Boolean(styleProfile.occasion)
    : quizStep === 1 ? Boolean(styleProfile.silhouette)
      : quizStep === 2 ? Boolean(styleProfile.palette)
        : quizStep === 3 ? styleProfile.priorities.length === 2
          : quizStep === 4 ? styleProfile.lookIds.length === 3
            : true;

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
          body: JSON.stringify({ consent, rightsConfirmed, scene: "main-stage", styleProfile }),
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
        purchaseIntentRecorded: false,
        wouldBuyAtTarget: null,
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

  async function recordPurchaseIntent(wouldBuyAtTarget: boolean) {
    if (!session) return;
    setBusy(wouldBuyAtTarget ? "intent:yes" : "intent:no");
    setError("");
    try {
      await api(`/api/sessions/${session.sessionId}/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "target_price", wouldBuyAtTarget }),
      });
      setSession({ ...session, purchaseIntentRecorded: true, wouldBuyAtTarget });
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
      setStyleProfile(emptyStyleProfile);
      setQuizStep(0);
      setPhase("style");
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="cast-shell">
      <header className="cast-header">
        <Brand />
        <div className="cast-header-route">
          <Link href="/studio">Buying room</Link>
          <p><span aria-hidden="true" /> Your private fitting</p>
        </div>
      </header>

      <nav className="cast-steps" aria-label="Casting progress">
        {(["access", "style", "portrait", "reveal"] as Phase[]).map((step, index, steps) => (
          <span key={step} className={phase === step ? "is-current" : index < steps.indexOf(phase) ? "is-done" : ""}>
            <b>0{index + 1}</b> {step === "access" ? "Welcome" : step === "style" ? "Your style" : step === "portrait" ? "Your photo" : "Your picks"}
          </span>
        ))}
      </nav>

      {phase === "access" && (
        <section className="cast-gate enter" aria-labelledby="access-title">
          <div className="gate-copy">
            <p className="eyebrow"><span aria-hidden="true">✦</span> You&apos;re invited</p>
            <h1 id="access-title">You have a say in what gets <em>made.</em></h1>
            <p>Try three unreleased looks on you. Choose the one you love, then tell the brand if the target price feels right.</p>
          </div>
          <form className="access-ticket" onSubmit={enterStage}>
            <div className="ticket-heading">
              <span aria-hidden="true">01</span>
              <div><strong>Welcome to your fitting</strong><p>Enter the code from your invitation.</p></div>
            </div>
            <div>
              <label htmlFor="access-code">Invitation code</label>
              <input id="access-code" name="code" type="password" autoComplete="one-time-code" required autoFocus />
            </div>
            <button className="cast-action" disabled={Boolean(busy)}>
              {busy === "access" ? "Checking your invite…" : "Start my fitting"}
              <span aria-hidden="true">→</span>
            </button>
            <small>Private, quick and no purchase required.</small>
          </form>
        </section>
      )}

      {phase === "style" && (
        <section className="style-quiz enter" aria-labelledby="style-title">
          <header className="style-quiz-heading">
            <div>
              <p className="eyebrow"><span aria-hidden="true">✦</span> Your personal edit</p>
              <h1 id="style-title">Tell us what feels like <em>you.</em></h1>
            </div>
            <div className="quiz-status">
              <span>{quizStep < 5 ? `Question ${quizStep + 1} of 5` : "Edit complete"}</span>
              <progress max="5" value={Math.min(quizStep + 1, 5)}>{Math.min(quizStep + 1, 5)} of 5</progress>
              <small>Your answers help the brand read demand beyond a single favorite.</small>
            </div>
          </header>

          <div className="quiz-panel" key={quizStep}>
            {quizStep === 0 && (
              <div className="quiz-question">
                <p className="quiz-kicker">Start with real life</p>
                <h2>Where do you most want your next great look to take you?</h2>
                <div className="quiz-text-grid">
                  {styleOccasions.map((option, index) => (
                    <button key={option.id} className="quiz-text-card" aria-pressed={styleProfile.occasion === option.id} onClick={() => setStyleProfile({ ...styleProfile, occasion: option.id })}>
                      <span>0{index + 1}</span><strong>{option.label}</strong><small>{option.note}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {quizStep === 1 && (
              <div className="quiz-question">
                <p className="quiz-kicker">Follow the shape</p>
                <h2>Which silhouette are you drawn to first?</h2>
                <div className="quiz-image-grid silhouette-grid">
                  {styleSilhouettes.map((option) => (
                    <button key={option.id} className="quiz-image-card" aria-pressed={styleProfile.silhouette === option.id} onClick={() => setStyleProfile({ ...styleProfile, silhouette: option.id })}>
                      <img src={option.image} alt="" /><span><strong>{option.label}</strong><i aria-hidden="true">✓</i></span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {quizStep === 2 && (
              <div className="quiz-question">
                <p className="quiz-kicker">Set the mood</p>
                <h2>Which colour world feels most at home in your wardrobe?</h2>
                <div className="quiz-palette-grid">
                  {stylePalettes.map((option) => (
                    <button key={option.id} className="quiz-palette-card" aria-pressed={styleProfile.palette === option.id} onClick={() => setStyleProfile({ ...styleProfile, palette: option.id })}>
                      <span className="palette-dots" aria-hidden="true">{option.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
                      <strong>{option.label}</strong><i className="quiz-check" aria-hidden="true">✓</i>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {quizStep === 3 && (
              <div className="quiz-question">
                <p className="quiz-kicker">Choose two · {styleProfile.priorities.length}/2 selected</p>
                <h2>What makes a piece worth bringing home?</h2>
                <div className="quiz-text-grid">
                  {stylePriorities.map((option, index) => {
                    const selected = styleProfile.priorities.includes(option.id);
                    return (
                      <button key={option.id} className="quiz-text-card" aria-pressed={selected} disabled={!selected && styleProfile.priorities.length === 2} onClick={() => togglePriority(option.id)}>
                        <span>0{index + 1}</span><strong>{option.label}</strong><small>{option.note}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {quizStep === 4 && (
              <div className="quiz-question">
                <p className="quiz-kicker">Build your rack · {styleProfile.lookIds.length}/3 selected</p>
                <h2>Pick the three looks you would try on right now.</h2>
                <div className="quiz-image-grid look-picker-grid">
                  {styleLooks.map((look) => {
                    const selected = styleProfile.lookIds.includes(look.id);
                    return (
                      <button key={look.id} className="quiz-image-card" aria-pressed={selected} disabled={!selected && styleProfile.lookIds.length === 3} onClick={() => toggleLook(look.id)}>
                        <img src={look.image} alt="" /><span><strong>{look.label}</strong><small>{look.tag}</small><i aria-hidden="true">{styleProfile.lookIds.indexOf(look.id) + 1 || "✓"}</i></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {quizStep === 5 && (
              <div className="quiz-summary">
                <div>
                  <p className="quiz-kicker">Your edit is ready</p>
                  <h2>A useful taste signal, before the try-on.</h2>
                  <dl>
                    <div><dt>Real life</dt><dd>{labelFor(styleOccasions, styleProfile.occasion)}</dd></div>
                    <div><dt>Silhouette</dt><dd>{labelFor(styleSilhouettes, styleProfile.silhouette)}</dd></div>
                    <div><dt>Palette</dt><dd>{labelFor(stylePalettes, styleProfile.palette)}</dd></div>
                    <div><dt>You value</dt><dd>{styleProfile.priorities.map((id) => labelFor(stylePriorities, id)).join(" + ")}</dd></div>
                  </dl>
                </div>
                <div className="quiz-summary-rack" aria-label="Your three selected looks">
                  {styleProfile.lookIds.map((id, index) => {
                    const look = styleLooks.find((item) => item.id === id)!;
                    return <figure key={id}><img src={look.image} alt={look.label} /><figcaption>0{index + 1} · {look.label}</figcaption></figure>;
                  })}
                </div>
              </div>
            )}

            <footer className="quiz-actions">
              <button className="quiz-back" disabled={quizStep === 0} onClick={() => setQuizStep((step) => Math.max(0, step - 1))}>← Back</button>
              <button className="cast-action" disabled={!quizReady} onClick={() => quizStep < 5 ? setQuizStep((step) => step + 1) : setPhase("portrait")}>
                {quizStep === 5 ? "Add my photo" : "Continue"}<span aria-hidden="true">→</span>
              </button>
            </footer>
          </div>
        </section>
      )}

      {phase === "portrait" && (
        <section className="portrait-stage enter" aria-labelledby="portrait-title">
          <div className="portrait-intro">
            <p className="eyebrow"><span aria-hidden="true">✦</span> Make it personal</p>
            <h1 id="portrait-title">Let&apos;s see the looks on <em>you.</em></h1>
            <p>A clear full-body photo helps create your three previews. It is processed for this fitting and not saved by Dress Rehearsal.</p>
          </div>

          <form className="portrait-form" onSubmit={startCasting}>
            <label className={`photo-drop ${preview ? "has-photo" : ""}`} htmlFor="photo">
              {preview ? (
                // A blob URL cannot be rendered by next/image.
                <img src={preview} alt="Selected portrait preview" />
              ) : session?.state === "uploaded" ? (
                <span><b>Photo received</b><small>Your three looks are ready to begin</small></span>
              ) : (
                <span><b>Add a full-body photo</b><small>JPEG, PNG or WebP · 1-10 MB</small></span>
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
                {busy === "casting" ? "Creating your three looks…" : session?.state === "uploaded" ? "Continue my fitting" : "Try all three looks"}
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
              <p className="eyebrow"><span aria-hidden="true">✦</span> Your fitting room</p>
              <h1 id="reveal-title">Three looks. <em>Which feels like you?</em></h1>
            </div>
            <p>{terminal ? "Pick the one you would actually wear. You will see its target price after your choice is locked." : "Each look appears when its preview is ready. This shows appearance, not physical fit."}</p>
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
                    {!task && <div className="look-state"><span aria-hidden="true" />Getting ready</div>}
                    {task?.state === "live" && <span className="proof-mark">Made with YouCam</span>}
                    <span className="look-number">0{index + 1}</span>
                  </div>
                  <div className="look-meta">
                    <div>
                      <h2>{garment.name}</h2>
                      <p>{selected && garment.targetPriceCents !== null ? `Target retail revealed · €${garment.targetPriceCents / 100}` : "Target retail revealed after selection"}</p>
                    </div>
                    {task?.state === "live" && (
                      <button
                        className="select-look"
                        aria-pressed={selected}
                        disabled={Boolean(busy) || Boolean(session.selectedGarmentId) || !terminal}
                        onClick={() => terminal && !session.selectedGarmentId && selectLook(garment.id)}
                      >
                        {selected ? "My favorite ✓" : session.selectedGarmentId ? "Choice closed" : !terminal ? "Waiting for all three" : busy === `select:${garment.id}` ? "Saving…" : "This is my favorite"}
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

          {selectedGarment && selectedGarment.targetPriceCents !== null && (
            <section className="selection-dock" aria-label="Target price question">
              <div>
                <p>Your favorite</p>
                <strong>{selectedGarment.name}</strong>
              </div>
              {session.purchaseIntentRecorded ? (
                <p className="intent-receipt">
                  <b>{session.wouldBuyAtTarget ? `Yes at €${selectedGarment.targetPriceCents / 100}` : `Not at €${selectedGarment.targetPriceCents / 100}`}</b>
                    Thanks, your answer is saved. No payment or preorder was created.
                </p>
              ) : (
                <>
                  <div className="price-signal">
                    <span>One last, useful question</span>
                    <b>Would you consider buying it at €{selectedGarment.targetPriceCents / 100}?</b>
                  </div>
                  <div className="intent-actions">
                    <button className="cast-action" disabled={Boolean(busy)} onClick={() => recordPurchaseIntent(true)}>
                      {busy === "intent:yes" ? "Recording…" : `Yes, at €${selectedGarment.targetPriceCents / 100}`}<span aria-hidden="true">→</span>
                    </button>
                    <button className="intent-decline" disabled={Boolean(busy)} onClick={() => recordPurchaseIntent(false)}>
                      {busy === "intent:no" ? "Recording…" : "Not at this price"}
                    </button>
                  </div>
                </>
              )}
            </section>
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

function labelFor(options: readonly { id: string; label: string }[], id: string) {
  return options.find((option) => option.id === id)?.label ?? "Not selected";
}
