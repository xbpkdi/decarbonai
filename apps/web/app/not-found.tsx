import { ChromeRuntime } from "@/components/ChromeRuntime";

export default function NotFound() {
  return (
    <main className="wrap" data-page="notfound" style={{ padding: "96px var(--gutter) 32px" }}>
      <span className="eyebrow">404</span>
      <h1 className="display" style={{ fontSize: "clamp(56px, 8vw, 120px)", marginTop: 12 }}>
        Nothing settled here.
      </h1>
      <p className="lead" style={{ marginTop: 18 }}>
        <a className="btn btn-primary" href="/">
          Back to Live
        </a>
      </p>
      <ChromeRuntime />
    </main>
  );
}
