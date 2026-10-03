import type { Metadata } from "next";
import { Big_Shoulders, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import { Header } from "@/components/Header";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], weight: "variable", axes: ["opsz"], variable: "--nf-display", display: "swap" });
const body = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], variable: "--nf-body", display: "swap" });
const data = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--nf-data", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Curvebook: the form guide for Meteora DBC curves", template: "%s · Curvebook" },
  description:
    "Every Meteora Dynamic Bonding Curve config, ranked by how much of the curve non-creator wallets buy in the first 10 slots.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${data.variable}`}>
      <body>
        <a href="#main" className="sr-only">Skip to content</a>
        <Header />
        <main id="main" className="wrap">{children}</main>
        <footer>
          <div className="wrap">
            Measured from Meteora DBC events on Solana mainnet. Every figure comes from the live index; nothing is backfilled
            before capture start. <a href="/about">How it is measured</a>.
          </div>
        </footer>
      </body>
    </html>
  );
}
