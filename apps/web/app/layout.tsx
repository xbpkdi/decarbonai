import type { Metadata, Viewport } from "next";
import { Anton, Archivo, JetBrains_Mono, Noto_Sans_Thai } from "next/font/google";
import { Providers } from "@/components/Providers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { NETWORK, SITE_URL, UNBACKED } from "@/lib/config";
import { HEADLINE } from "@/lib/copy";
import { demoConfig } from "@/lib/server/demo";

// Developers "Run" / Agent "Pay one call" need every demo setting (see apps/web/README.md).
const DEMO_READY = Boolean(demoConfig());
import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton", display: "swap" });
const archivo = Archivo({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const mono = JetBrains_Mono({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-mono", display: "swap" });
const thai = Noto_Sans_Thai({ weight: ["400", "500", "600"], subsets: ["thai"], variable: "--font-thai", display: "swap" });

const description = `${NETWORK.testnet ? `Demo on ${NETWORK.name}` : `x402 carbon meter on ${NETWORK.name}`}. An x402 payment includes a carbon surcharge; a trusted meter records the estimated grams in batches, and each 1 kg burns a ${UNBACKED ? "mock credit" : "backed credit"} and mints a soulbound receipt.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `DecarbonAI · ${HEADLINE}`, template: "%s · DecarbonAI" },
  description,
  openGraph: { siteName: "DecarbonAI", type: "website", description },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#080a09", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-demo={DEMO_READY ? "1" : undefined} className={`fx-rich ${anton.variable} ${archivo.variable} ${mono.variable} ${thai.variable}`}>
      <body>
        <Providers>
          <div className="atmo" aria-hidden="true">
            <div className="aur a1" />
            <div className="aur a2" />
            <div className="aur a3" />
            <div className="grid" />
            <div className="grain" />
          </div>
          <SiteHeader />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
