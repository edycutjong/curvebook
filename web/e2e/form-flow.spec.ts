import { expect, test } from "@playwright/test";

test("Form → config readout and toll → form-line pool → 10-cell receipt", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The Form", level: 1 })).toBeVisible();

  const firstConfig = page.locator('table.formtable a[href^="/config/"]').first();
  await expect(firstConfig).toBeVisible();
  await firstConfig.click();
  await expect(page).toHaveURL(/\/config\/\w+/);

  // Readout: the plain-language decode of the curve.
  await expect(page.getByRole("heading", { name: "What this curve does" })).toBeVisible();
  expect(await page.locator("ul.readout li").count()).toBeGreaterThan(0);
  // Toll row: base fee in bps for each of the first ten slots/seconds.
  const toll = page.locator(".toll table");
  await expect(toll).toBeVisible();
  await expect(toll.getByRole("rowheader", { name: "bps" })).toBeVisible();
  expect(await toll.locator("tbody td").count()).toBe(10);

  const pool = page.locator('ol.formline a[href^="/pool/"]').first();
  await expect(pool).toBeVisible();
  await pool.click();
  await expect(page).toHaveURL(/\/pool\/\w+/);
  await expect(page.locator("svg.strip-lg g.cell")).toHaveCount(10);
});
