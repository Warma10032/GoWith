import { expect, test } from "@playwright/test";

test("renders public MVP pages and admin login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "推荐店铺" })).toBeVisible();
  const disclaimer = page.getByText("AI 总结，仅供参考");
  if ((await disclaimer.count()) > 0) {
    await expect(disclaimer.first()).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "还没有可推荐的店铺" })).toBeVisible();
  }

  await page.goto("/map");
  await expect(page.getByRole("heading", { name: "全国探店地图" })).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "GoWith 数据中台" })).toBeVisible();
});
