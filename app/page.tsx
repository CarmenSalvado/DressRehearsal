const looks = [
  ["S–01", "Silver Headliner"],
  ["S–02", "Crimson Entrance"],
  ["S–03", "Midnight Icon"],
];

export default function Home() {
  return (
    <main className="landing">
      <div className="stage-image" aria-hidden="true">
        <div className="stage-scene">
          <span className="dress dress-silver" />
          <span className="dress dress-crimson" />
          <span className="dress dress-midnight" />
        </div>
      </div>
      <div className="stage-glow" aria-hidden="true" />
      <div className="curtain curtain-left" aria-hidden="true" />
      <div className="curtain curtain-right" aria-hidden="true" />

      <header className="masthead enter enter-1">
        <a className="wordmark" href="/" aria-label="Dress Rehearsal home">
          <span className="monogram" aria-hidden="true">DR</span>
          <span>Dress Rehearsal</span>
        </a>
        <span className="stage-label">
          <span aria-hidden="true" /> Pre-production live
        </span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow enter enter-2">
          Demand before inventory <span aria-hidden="true">·</span> YouCam Apparel VTO
        </p>
        <h1 id="hero-title" className="enter enter-3">
          Make what
          <em>earns the spotlight.</em>
        </h1>
        <p className="hero-copy enter enter-4">
          Put three unreleased samples on a real audience before placing a production order.
          Selection becomes demand. Backing becomes the greenlight.
        </p>
        <div className="hero-action enter enter-5">
          <a className="primary-action" href="/cast">
            <span>Enter audience preview</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </a>
          <a className="studio-action" href="/studio">Open production room <span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <aside className="look-index enter enter-5" aria-label="Samples in contention">
        <p>Samples in contention</p>
        <ol>
          {looks.map(([number, name]) => (
            <li key={number}>
              <span>{number}</span> {name}
            </li>
          ))}
        </ol>
      </aside>

      <p className="edition enter enter-4" aria-label="First edition, pre-production">
        First edition <span aria-hidden="true">/</span> Pre-production
      </p>

      <footer className="footer enter enter-5">
        <p>© Dress Rehearsal · Demand before inventory</p>
        <div className="footer-links">
          <details className="info">
            <summary>Privacy</summary>
            <div className="info-panel">
              <strong>Your photograph stays yours.</strong>
              <p>
                Perfect Corp processes uploaded photos to create previews. This application
                does not retain the original after upload completes.
              </p>
            </div>
          </details>
          <details className="info">
            <summary>Technical receipt</summary>
            <div className="info-panel receipt-panel">
              <strong>Every result carries proof.</strong>
              <p>
                Live YouCam results, selections and explicit backing stay distinct. No payment
                is taken in this validation campaign.
              </p>
            </div>
          </details>
        </div>
      </footer>
    </main>
  );
}
