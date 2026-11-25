import type { Metadata } from "next";
import { ChromeRuntime } from "@/components/ChromeRuntime";

export const metadata: Metadata = { title: "v1 certificate", robots: { index: false } };

/** Old shared links: v1 certificate ids are not v2 receipt numbers, so never map one to the other. */
export default function OldCertificate() {
  return (
    <main className="wrap" data-page="certificate" style={{ padding: "96px var(--gutter)" }}>
      <span className="eyebrow">v1 certificate</span>
      <h1 className="display" style={{ fontSize: "clamp(56px, 8vw, 120px)", marginTop: 12 }}>
        Not carried over.
      </h1>
      <p className="lead" style={{ marginTop: 18 }}>
        This link is from the v1 demo. Its certificates are no longer hosted here, and they are not v2 receipts.
      </p>
      <p style={{ marginTop: 18 }}>
        <a className="btn btn-primary" href="/receipts">
          See v2 receipts
        </a>
      </p>
      <ChromeRuntime />
    </main>
  );
}
