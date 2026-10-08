import { describe, expect, it } from "vitest";
import { DESCRIPTION, OG_IMAGE, OPEN_GRAPH, TITLE } from "@/lib/site";

describe("site metadata", () => {
  it("description fits the meta-description window (50-160) and the og:description mobile limit (125)", () => {
    expect(DESCRIPTION.length).toBeGreaterThanOrEqual(50);
    expect(DESCRIPTION.length).toBeLessThanOrEqual(125);
  });

  it("og image is declared at exactly 1200x630 and the card carries a site name", () => {
    expect([OG_IMAGE.width, OG_IMAGE.height]).toEqual([1200, 630]);
    expect(OPEN_GRAPH).toMatchObject({ siteName: "Curvebook", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] });
  });
});
