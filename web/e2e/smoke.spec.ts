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
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og-image\.jpg$/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Curvebook/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
}

test("og image is served at 1200x630", async ({ request }) => {
  const res = await request.get("/og-image.jpg");
  expect(res.status()).toBe(200);
  const buf = await res.body();
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  // JPEG SOF0/SOF2 frame header: height then width, big-endian u16 at +5 and +7 from the marker.
  let i = 2;
  while (i < buf.length && !(buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2))) i += 2 + buf.readUInt16BE(i + 2);
  expect([buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]).toEqual([1200, 630]);
});
