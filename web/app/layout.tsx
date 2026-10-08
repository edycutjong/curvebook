import type { Metadata } from "next";
import { Big_Shoulders, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import { Header } from "@/components/Header";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], weight: "variable", axes: ["opsz"], variable: "--nf-display", display: "swap" });
const body = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], variable: "--nf-body", display: "swap" });
const data = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--nf-data", display: "swap" });

import { DESCRIPTION, OG_IMAGE, OPEN_GRAPH, TITLE } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: TITLE, template: "%s · Curvebook" },
  description: DESCRIPTION,
  icons: { icon: "/icon.svg" },
  authors: [{ name: "Edy Cu", url: "https://github.com/edycutjong" }],
  creator: "Edy Cu",
  openGraph: OPEN_GRAPH,
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url], creator: "@edycutjong" },
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
