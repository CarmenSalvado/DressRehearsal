"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Report = {
  campaign: {
    id: string;
    name: string;
    productionSlots: number;
    greenlightThreshold: number;
    greenlitGarmentId: string | null;
  };
  totals: { decisions: number; backers: number; backingRate: number };
  garments: Array<{
    id: string;
    name: string;
    targetPriceCents: number;
    image: string;
    decisions: number;
    backers: number;
    averageWillingPriceCents: number | null;
    progress: number;
    status: "collecting" | "leading" | "greenlit";
  }>;
};

export default function StudioPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reportAvailable = report !== null;

  async function loadReport() {
    const response = await fetch("/api/studio", { cache: "no-store" });
    if (response.status === 401) {
      setReport(null);
      setLocked(true);
      return;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? "The production report could not be loaded.");
    setReport(payload);
    setLocked(false);
    setError("");
  }

  useEffect(() => {
    loadReport().catch((reason) => setError(messageFor(reason)));
  }, []);

  useEffect(() => {
    if (!reportAvailable) return;
    const timer = window.setInterval(() => loadReport().catch((reason) => setError(messageFor(reason))), 5000);
    return () => window.clearInterval(timer);
  }, [reportAvailable]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: form.get("code") }),
      });
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "The invitation code is not valid.");
      await loadReport();
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <main className="studio-shell studio-locked">
        <StudioHeader />
        <section className="cast-gate enter" aria-labelledby="studio-access-title">
          <div className="gate-copy">
            <p className="eyebrow">Manufacturer access · Live campaign</p>
            <h1 id="studio-access-title">The buying room is <em>private.</em></h1>
            <p>Enter the campaign code to see real audience decisions, backing and price signals.</p>
          </div>
          <form className="access-ticket" onSubmit={unlock}>
            <p>Production room</p>
            <div>
              <label htmlFor="studio-code">Campaign code</label>
              <input id="studio-code" name="code" type="password" autoComplete="one-time-code" required autoFocus />
            </div>
            <button className="cast-action" disabled={busy}>{busy ? "Opening report…" : "Open live report"}<span aria-hidden="true">→</span></button>
            <small>Same private code as the audience preview.</small>
          </form>
        </section>
        {error && <p className="cast-error" role="alert">{error}</p>}
      </main>
    );
  }

  if (!report) {
    return <main className="studio-shell"><StudioHeader /><p className="studio-loading">Preparing the production report…</p>{error && <p className="cast-error" role="alert">{error}</p>}</main>;
  }

  const greenlit = report.garments.find((garment) => garment.id === report.campaign.greenlitGarmentId);

  return (
    <main className="studio-shell">
      <StudioHeader />

      <section className="studio-hero enter">
        <div>
          <p className="eyebrow">Production room · {report.campaign.name}</p>
          <h1>The audience is writing the <em>buying order.</em></h1>
        </div>
        <div className={`production-verdict ${greenlit ? "is-greenlit" : ""}`}>
          <p>{greenlit ? "Greenlight reached" : "One production slot"}</p>
          <strong>{greenlit?.name ?? `${Math.max(0, report.campaign.greenlightThreshold - Math.max(...report.garments.map((garment) => garment.backers)))} backers still needed`}</strong>
          <span>{greenlit ? "Audience threshold met · ready for manufacturer review" : `First sample to ${report.campaign.greenlightThreshold} genuine backers earns review`}</span>
        </div>
      </section>

      <section className="studio-metrics" aria-label="Campaign totals">
        <article><p>Audience decisions</p><strong>{report.totals.decisions}</strong><span>Completed sample selections</span></article>
        <article><p>Commercial backers</p><strong>{report.totals.backers}</strong><span>Explicit willingness to buy</span></article>
        <article><p>Decision → backing</p><strong>{report.totals.backingRate}%</strong><span>Intent, not checkout conversion</span></article>
      </section>

      <section className="production-board" aria-labelledby="board-title">
        <header>
          <div><p className="eyebrow">Live sample board</p><h2 id="board-title">What has earned production?</h2></div>
          <p>Updated every five seconds. No seeded votes, inferred preferences or fit claims.</p>
        </header>

        <div className="sample-ledger">
          {report.garments.map((garment, index) => (
            <article className={`sample-row status-${garment.status}`} key={garment.id}>
              <div className="sample-thumb"><img src={garment.image} alt={garment.name} /><span>0{index + 1}</span></div>
              <div className="sample-name">
                <p>{garment.status === "greenlit" ? "Greenlit" : garment.status === "leading" ? "Current leader" : "Collecting demand"}</p>
                <h3>{garment.name}</h3>
                <span>Target retail · {euros(garment.targetPriceCents)}</span>
              </div>
              <div className="sample-progress">
                <div><span>Backers</span><b>{garment.backers} / {report.campaign.greenlightThreshold}</b></div>
                <progress max="100" value={garment.progress}>{garment.progress}%</progress>
                <small>{garment.progress}% to greenlight</small>
              </div>
              <dl>
                <div><dt>Finalist votes</dt><dd>{garment.decisions}</dd></div>
                <div><dt>Avg. willing price</dt><dd>{garment.averageWillingPriceCents ? euros(garment.averageWillingPriceCents) : "—"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <footer className="studio-footer">
        <p><b>Signal definition.</b> A vote is a completed live VTO selection. A backer additionally states a price they would genuinely pay. No payment, preorder or manufacturing commitment is created.</p>
        <Link href="/cast">Open audience preview <span aria-hidden="true">→</span></Link>
      </footer>
    </main>
  );
}

function StudioHeader() {
  return (
    <header className="studio-header">
      <Link className="wordmark" href="/" aria-label="Dress Rehearsal home"><span className="monogram" aria-hidden="true">DR</span><span>Dress Rehearsal</span></Link>
      <nav><Link href="/cast">Audience preview</Link><span>Production room</span></nav>
    </header>
  );
}

function euros(cents: number) {
  return `€${Math.round(cents / 100)}`;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "The production room hit an unexpected problem.";
}
