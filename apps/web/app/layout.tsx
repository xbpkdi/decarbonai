import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { type Net, SITE_URL } from "@/lib/config";
import { HEADLINE } from "@/lib/copy";
import { demoConfig } from "@/lib/server/demo";
import { getNet } from "@/lib/server/net";

// Developers "Run" / Agent "Pay one call" need every demo setting (see apps/web/README.md).
const DEMO_READY = Boolean(demoConfig());
import "./globals.css";

// Self-hosted (from google/fonts, subset to the ranges Google Fonts serves) so builds never fetch fonts.
const anton = localFont({ src: "./fonts/Anton-Regular.woff2", weight: "400", variable: "--font-anton", display: "swap" });
const archivo = localFont({ src: "./fonts/Archivo-Variable.woff2", weight: "100 900", variable: "--font-archivo", display: "swap" });
const mono = localFont({ src: "./fonts/JetBrainsMono-Variable.woff2", weight: "400 800", variable: "--font-mono", display: "swap" });
const thai = localFont({ src: "./fonts/NotoSansThai-Variable.woff2", weight: "100 900", variable: "--font-thai", display: "swap" });

const describe = (net: Net) =>
  `${net.testnet ? `Demo on ${net.name}` : `x402 carbon meter on ${net.name}`}. An x402 payment includes a carbon surcharge; a trusted meter records the estimated grams in batches, and each 1 kg burns a ${net.unbacked ? "mock credit" : "backed credit"} and mints a soulbound receipt.`;

export async function generateMetadata(): Promise<Metadata> {
  const description = describe(await getNet());
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `DecarbonAI · ${HEADLINE}`, template: "%s · DecarbonAI" },
    description,
    openGraph: { siteName: "DecarbonAI", type: "website", description },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = { themeColor: "#080a09", colorScheme: "dark" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const net = await getNet();
  return (
    <html lang="en" data-net={net.id} data-demo={DEMO_READY ? "1" : undefined} className={`fx-rich ${anton.variable} ${archivo.variable} ${mono.variable} ${thai.variable}`}>
      <body>
        <Providers net={net.id}>
          <div className="atmo" aria-hidden="true">
            <div className="aur a1" />
            <div className="aur a2" />
            <div className="aur a3" />
            <div className="grid" />
            <div className="grain" />
          </div>
          <SiteHeader />
          {children}
          <SiteFooter net={net} />
        </Providers>
      </body>
    </html>
  );
}
