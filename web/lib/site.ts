// Site-wide metadata shared by the root layout and the home page (which adds og:url).
export const TITLE = "Curvebook — the form guide for Meteora DBC curves";
export const DESCRIPTION =
  "Every Meteora Dynamic Bonding Curve config, ranked by how much of the curve non-creator wallets buy in the first 10 slots.";
export const OG_IMAGE = { url: "/og-image.jpg", width: 1200, height: 630, alt: "Curvebook: the form guide for Meteora DBC curves" };
export const OPEN_GRAPH = { type: "website" as const, siteName: "Curvebook", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] };
