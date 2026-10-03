import { expect, test } from "@playwright/test";

for (const path of ["/", "/about", "/integrations/verify"]) {
  test(`${path} loads clean with title and social meta`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));

    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page).toHaveTitle(/Curvebook/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og-image\.png$/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Curvebook/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
}

test("og image is served at 1200x630", async ({ request }) => {
  const res = await request.get("/og-image.png");
  expect(res.status()).toBe(200);
  const buf = await res.body();
  // PNG IHDR: width and height are big-endian u32 at bytes 16 and 20.
  expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1200, 630]);
});
