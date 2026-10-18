import { expect, test, type Page } from "@playwright/test";
import { clickWorkspaceModule } from "./helpers/workspace-navigation";

async function moduleFixture(page: Page) {
  await page.setContent(`
    <style>
      button { position: fixed; left: 220px; top: 180px; width: 180px; height: 90px; }
      #overlay { position: fixed; inset: 0; z-index: 10; }
    </style>
    <main data-testid="neural-workspace" data-module="hub">
      <button data-testid="neural-module-canvases"><span>画布</span></button>
      <output id="clicks">0</output>
    </main>
    <script>
      const button = document.querySelector('button');
      button.addEventListener('click', (event) => {
        document.querySelector('#clicks').dataset.trusted = String(event.isTrusted);
        document.querySelector('#clicks').textContent = String(
          Number(document.querySelector('#clicks').textContent) + 1
        );
        document.querySelector('main').dataset.module = 'canvases';
      });
    </script>
  `);
  const click = page.mouse.click.bind(page.mouse);
  let mouseClickCalls = 0;
  page.mouse.click = async (...args: Parameters<typeof click>) => {
    mouseClickCalls++;
    await click(...args);
  };
  return () => mouseClickCalls;
}

async function expectBlocked(page: Page, mouseClickCalls: () => number) {
  await expect(
    clickWorkspaceModule(page, "canvases", { timeout: 250 }),
  ).rejects.toThrow();
  expect(mouseClickCalls()).toBe(0);
  await expect(page.locator("#clicks")).toHaveText("0");
  await expect(page.getByTestId("neural-workspace")).toHaveAttribute(
    "data-module",
    "hub",
  );
}

test("moving workspace module receives one real mouse click", async ({ page }) => {
  const mouseClickCalls = await moduleFixture(page);
  await page.evaluate(() => {
    const button = document.querySelector("button")!;
    let frame = 0;
    const move = () => {
      button.style.left = `${220 + (frame++ % 2) * 8}px`;
      requestAnimationFrame(move);
    };
    requestAnimationFrame(move);
  });

  await clickWorkspaceModule(page, "canvases");

  expect(mouseClickCalls()).toBe(1);
  await expect(page.locator("#clicks")).toHaveText("1");
  await expect(page.locator("#clicks")).toHaveAttribute("data-trusted", "true");
});

test("workspace module behind an overlay is never clicked", async ({ page }) => {
  const mouseClickCalls = await moduleFixture(page);
  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.id = "overlay";
    document.body.append(overlay);
  });

  await expectBlocked(page, mouseClickCalls);
});

test("disabled workspace module is never clicked", async ({ page }) => {
  const mouseClickCalls = await moduleFixture(page);
  await page.getByTestId("neural-module-canvases").evaluate((button) => {
    (button as HTMLButtonElement).disabled = true;
  });

  await expectBlocked(page, mouseClickCalls);
});

test("workspace module outside the viewport is never clicked", async ({ page }) => {
  const mouseClickCalls = await moduleFixture(page);
  await page.getByTestId("neural-module-canvases").evaluate((button) => {
    button.style.top = "-200px";
  });

  await expectBlocked(page, mouseClickCalls);
});

test("workspace module is checked again after moving the pointer", async ({ page }) => {
  const mouseClickCalls = await moduleFixture(page);
  await page.evaluate(() => {
    document.addEventListener("pointermove", () => {
      const overlay = document.createElement("div");
      overlay.id = "overlay";
      document.body.append(overlay);
    }, { once: true });
  });

  await expectBlocked(page, mouseClickCalls);
  await expect(page.locator("#overlay")).toHaveCount(1);
});
