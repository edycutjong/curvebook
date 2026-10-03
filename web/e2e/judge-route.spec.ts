import { expect, test } from "@playwright/test";

const CLAIM =
  "Curvebook measures how much of every Meteora DBC launch outside wallets buy in its first ten slots, and lets you launch on a curve by that record.";

test("/judge is public: a fresh context with no cookies gets 200 and the claim", async ({ browser }) => {
  const context = await browser.newContext();
  expect(await context.cookies()).toEqual([]);
  const page = await context.newPage();
  const res = await page.goto("/judge");
  expect(res?.status()).toBe(200);
  await expect(page.getByText(CLAIM)).toBeVisible();
  await expect(page.getByRole("heading", { name: "30-second path" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Honest limitations" })).toBeVisible();
  await context.close();
});

test("/judge links resolve to live pages", async ({ page }) => {
  await page.goto("/judge");
  const hrefs = await page.locator('section[aria-labelledby="path-h"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThanOrEqual(3);
  for (const href of hrefs) {
    const res = await page.request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test("header nav has a Judges link", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Judges" }).click();
  await expect(page).toHaveURL(/\/judge$/);
});
