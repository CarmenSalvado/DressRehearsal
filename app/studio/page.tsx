"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Brand } from "../brand";
import { styleLooks, styleOccasions, stylePalettes, stylePriorities, styleSilhouettes } from "../../lib/style-profile";

type RankedSignal = { id: string; count: number };

type Report = {
  campaign: {
    id: string;
    name: string;
    productionSlots: number;
    reviewThreshold: number;
    audienceFavoriteGarmentIds: string[];
    commercialFavoriteGarmentIds: string[];
    reviewCandidateGarmentId: string | null;
  };
  totals: { decisions: number; priceResponses: number; qualifiedIntents: number; qualificationRate: number };
  styleSignals: {
    responses: number;
    occasions: RankedSignal[];
    silhouettes: RankedSignal[];
    palettes: RankedSignal[];
    priorities: RankedSignal[];
    looks: RankedSignal[];
  };
  garments: Array<{
    id: string;
    name: string;
    targetPriceCents: number;
    image: string;
    decisions: number;
    priceResponses: number;
    qualifiedIntents: number;
    qualificationRate: number;
    progress: number;
    isAudienceFavorite: boolean;
    isCommercialFavorite: boolean;
    isReviewReady: boolean;
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
    if (!response.ok) throw new Error(payload?.error?.message ?? "The buying report could not be loaded.");
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
        body: JSON.stringify({ code: form.get("code"), room: "buying" }),
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
            <p className="eyebrow"><span aria-hidden="true">✦</span> Live merchandising signal</p>
            <h1 id="studio-access-title">Welcome to the <em>buying room.</em></h1>
            <p>See what customers love, what they would buy at target retail and which sample deserves the next review.</p>
          </div>
          <form className="access-ticket" onSubmit={unlock}>
            <div className="ticket-heading">
              <span aria-hidden="true">B</span>
              <div><strong>Brand access</strong><p>Use the separate campaign code.</p></div>
            </div>
            <div>
              <label htmlFor="studio-code">Campaign code</label>
              <input id="studio-code" name="code" type="password" autoComplete="one-time-code" required autoFocus />
            </div>
            <button className="cast-action" disabled={busy}>{busy ? "Opening report…" : "Open live report"}<span aria-hidden="true">→</span></button>
            <small>Private to the merchandising team.</small>
          </form>
        </section>
        {error && <p className="cast-error" role="alert">{error}</p>}
      </main>
    );
  }

  if (!report) {
    return <main className="studio-shell"><StudioHeader /><p className="studio-loading">Preparing the buying report…</p>{error && <p className="cast-error" role="alert">{error}</p>}</main>;
  }

  const audienceFavorites = report.garments.filter((garment) => report.campaign.audienceFavoriteGarmentIds.includes(garment.id));
  const commercialFavorites = report.garments.filter((garment) => report.campaign.commercialFavoriteGarmentIds.includes(garment.id));
  const audienceFavorite = audienceFavorites.length === 1 ? audienceFavorites[0] : null;
  const commercialFavorite = commercialFavorites.length === 1 ? commercialFavorites[0] : null;
  const reviewCandidate = report.garments.find((garment) => garment.id === report.campaign.reviewCandidateGarmentId);
  const favoriteDiverges = Boolean(audienceFavorite && commercialFavorite && audienceFavorite.id !== commercialFavorite.id);
  const audienceTie = audienceFavorites.length > 1;
  const commercialTie = commercialFavorites.length > 1;
  const qualifiedLeaderCount = Math.max(...report.garments.map((garment) => garment.qualifiedIntents));

  return (
    <main className="studio-shell">
      <StudioHeader />

      <section className="studio-hero enter">
        <div>
          <p className="eyebrow"><span aria-hidden="true">✦</span> {report.campaign.name}</p>
          <h1>See what people love <em>and what they’d buy.</em></h1>
        </div>
        <div className={`production-verdict ${reviewCandidate ? "is-ready" : ""}`}>
          <p>{favoriteDiverges ? "Audience favorite ≠ commercial favorite" : commercialTie ? "Commercial evidence is tied" : audienceTie ? "Audience preference is tied" : reviewCandidate ? "Buyer review ready" : "One inventory decision"}</p>
          <strong>{reviewCandidate?.name ?? commercialFavorite?.name ?? (commercialTie ? "Buyer judgment needed" : "Collecting evidence")}</strong>
          <span>
            {favoriteDiverges
              ? `${audienceFavorite!.name} won preference. ${commercialFavorite!.name} won target-price intent${reviewCandidate ? " and cleared buyer review." : "."}`
              : commercialTie
                ? `${favoriteNames(commercialFavorites)} are tied on target-price intent. No commercial winner is declared.`
                : audienceTie
                  ? `${favoriteNames(audienceFavorites)} are tied on personal preference. Commercial evidence remains separate.`
              : reviewCandidate
                  ? `${reviewCandidate.qualifiedIntents} customers answered yes at target retail · threshold met`
                  : commercialFavorite
                    ? `${Math.max(0, report.campaign.reviewThreshold - qualifiedLeaderCount)} more target-price yes responses needed for buyer review`
                    : "Preference is recorded first. Target retail is revealed only after the choice is locked."}
          </span>
        </div>
      </section>

      <section className="studio-metrics" aria-label="Campaign totals">
        <article><p>Audience favorite</p><strong className="metric-name">{favoriteNames(audienceFavorites)}</strong><span>{audienceFavorites.length ? `${audienceFavorites[0].decisions} personal preference vote${audienceFavorites[0].decisions === 1 ? "" : "s"}${audienceTie ? " each · tie" : ""}` : "Waiting for a completed choice"}</span></article>
        <article><p>Commercial favorite</p><strong className="metric-name">{favoriteNames(commercialFavorites)}</strong><span>{commercialFavorites.length ? `${commercialFavorites[0].qualifiedIntents} yes at target retail${commercialTie ? " each · tie" : ""}` : "Waiting for a target-price yes"}</span></article>
        <article><p>Target-price intent</p><strong>{report.totals.qualificationRate}%</strong><span>{report.totals.qualifiedIntents} yes · {report.totals.priceResponses} answered</span></article>
      </section>

      <section className="style-pulse" aria-labelledby="style-pulse-title">
        <header>
          <div><p className="eyebrow">Audience style pulse</p><h2 id="style-pulse-title">Read the wardrobe <em>before buying inventory.</em></h2></div>
          <p>{report.styleSignals.responses} completed style edit{report.styleSignals.responses === 1 ? "" : "s"}. These discovery signals add context; the locked sample and target-price responses remain the commercial decision.</p>
        </header>
        <div className="style-pulse-grid">
          <SignalCard title="Leading occasion" signal={report.styleSignals.occasions} options={styleOccasions} />
          <SignalCard title="Leading silhouette" signal={report.styleSignals.silhouettes} options={styleSilhouettes} />
          <SignalCard title="Leading palette" signal={report.styleSignals.palettes} options={stylePalettes} />
          <SignalCard title="What customers value" signal={report.styleSignals.priorities} options={stylePriorities} />
        </div>
        <div className="style-demand-rack">
          <div><p>Most wanted from the discovery rack</p><strong>{report.styleSignals.looks.length ? "Early creative direction" : "Waiting for style edits"}</strong></div>
          {report.styleSignals.looks.slice(0, 3).map((signal, index) => {
            const look = styleLooks.find((item) => item.id === signal.id);
            return look ? <article key={look.id}><img src={look.image} alt={look.label} /><span>0{index + 1}</span><p>{look.label}</p><small>{signal.count} pick{signal.count === 1 ? "" : "s"}</small></article> : null;
          })}
        </div>
      </section>

      <section className="production-board" aria-labelledby="board-title">
        <header>
          <div><p className="eyebrow">Live commercial evidence</p><h2 id="board-title">What deserves inventory capital?</h2></div>
          <p>Updated every five seconds. No sales forecast, seeded votes, inferred preferences or fit claims.</p>
        </header>

        <div className="sample-ledger">
          {report.garments.map((garment, index) => (
            <article className={`sample-row ${garment.isReviewReady ? "status-ready" : garment.isCommercialFavorite ? "status-commercial" : garment.isAudienceFavorite ? "status-audience" : ""}`} key={garment.id}>
              <div className="sample-thumb"><img src={garment.image} alt={garment.name} /><span>0{index + 1}</span></div>
              <div className="sample-name">
                <p>{garment.isReviewReady ? "Buyer review ready" : garment.isAudienceFavorite && garment.isCommercialFavorite ? "Taste + commercial favorite" : garment.isCommercialFavorite ? "Commercial favorite" : garment.isAudienceFavorite ? "Audience favorite" : "Collecting evidence"}</p>
                <h3>{garment.name}</h3>
                <span>Target retail · {euros(garment.targetPriceCents)}</span>
              </div>
              <div className="sample-progress">
                <div><span>Yes at target</span><b>{garment.qualifiedIntents} / {report.campaign.reviewThreshold}</b></div>
                <progress max="100" value={garment.progress}>{garment.progress}%</progress>
                <small>{garment.progress}% to buyer-review threshold</small>
              </div>
              <dl>
                <div><dt>Preference votes</dt><dd>{garment.decisions}</dd></div>
                <div><dt>Target-price yes</dt><dd>{garment.qualificationRate}%</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <footer className="studio-footer">
        <p><b>Signal definition.</b> A preference is locked before price reveal. Qualified intent means “yes” at the configured target retail. It is not a sale, preorder, forecast or production commitment.</p>
        <Link href="/cast">Open customer panel <span aria-hidden="true">→</span></Link>
      </footer>
    </main>
  );
}

function StudioHeader() {
  return (
    <header className="studio-header">
      <Brand />
      <nav><Link href="/cast">Customer panel</Link><span>Buying room</span></nav>
    </header>
  );
}

function euros(cents: number) {
  return `€${Math.round(cents / 100)}`;
}

function favoriteNames(garments: Report["garments"]) {
  return garments.length ? garments.map((garment) => garment.name).join(" / ") : "No signal";
}

function SignalCard({ title, signal, options }: { title: string; signal: RankedSignal[]; options: readonly { id: string; label: string }[] }) {
  const leaders = signal.length ? signal.filter((item) => item.count === signal[0].count) : [];
  return <article><p>{title}</p><strong>{leaders.length ? leaders.map((item) => options.find((option) => option.id === item.id)?.label).join(" / ") : "No signal"}</strong><span>{leaders.length ? `${leaders[0].count} response${leaders[0].count === 1 ? "" : "s"}${leaders.length > 1 ? " each · tie" : ""}` : "Waiting for responses"}</span></article>;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "The buying room hit an unexpected problem.";
}
