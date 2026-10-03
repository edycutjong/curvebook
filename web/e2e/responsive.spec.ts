import { expect, test } from "@playwright/test";

const WIDTHS = [375, 768, 1440];
const PATHS = ["/", "/judge", "/about", "/integrations/verify"];

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const path of PATHS) {
      test(`${path}: no horizontal overflow, header fits`, async ({ page }) => {
        await page.goto(path);
        const m = await page.evaluate(() => {
          const header = document.querySelector("header.masthead")!.getBoundingClientRect();
          // body has overflow-x: hidden, so measure content that would spill past the viewport.
          const spill = [...document.querySelectorAll("main *, header *")].filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0) return false;
            // Content inside an intentional horizontal scroller is fine.
            for (let p = el.parentElement; p; p = p.parentElement) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === "auto" || ox === "scroll") return false;
            }
            return r.right > window.innerWidth + 1 || r.left < -1;
          });
          return {
            vw: window.innerWidth,
            doc: document.documentElement.scrollWidth,
            headerRight: header.right,
            spill: spill.slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
          };
        });
        expect(m.doc).toBeLessThanOrEqual(m.vw);
        expect(m.headerRight).toBeLessThanOrEqual(m.vw);
        expect(m.spill).toEqual([]);
      });
    }

    test("header targets are at least 36px tall", async ({ page }) => {
      await page.goto("/");
      const heights = await page.locator("header.masthead a").evaluateAll((as) =>
        as.map((a) => ({ text: a.textContent?.trim(), h: a.getBoundingClientRect().height })),
      );
      expect(heights.length).toBeGreaterThanOrEqual(5);
      for (const { text, h } of heights) expect(h, text).toBeGreaterThanOrEqual(36);
    });
  });
}
