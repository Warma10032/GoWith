import { expect, test } from "@playwright/test";

test("renders public MVP pages and admin login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "推荐店铺" })).toBeVisible();
  await expect(page.getByText("AI 总结，仅供参考").first()).toBeVisible();

  await page.goto("/map");
  await expect(page.getByRole("heading", { name: "全国探店地图" })).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "GoWith Admin" })).toBeVisible();
});
