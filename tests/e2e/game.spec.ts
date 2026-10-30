import { expect, test, type Page } from '@playwright/test';

async function createProfile(page: Page, name: string): Promise<void> {
  await page.goto('/profile');
  await page.getByTestId('player-name').fill(name);
  await page.getByTestId('save-profile').click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
}

async function waitForGame(page: Page): Promise<void> {
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await expect(page.getByTestId('status-bar')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('connection-status').first()).toHaveAttribute('data-status', 'connected');
}

test.describe.serial('Blockhaven in the browser', () => {
  let worldUrl = '';

  test('main menu navigation', async ({ page }) => {
    await page.goto('/');
    const menu = page.getByTestId('main-menu');
    for (const label of ['Play', 'Singleplayer', 'Multiplayer', 'Create World', 'Join World', 'Settings', 'Player Profile', 'Exit Game']) {
      await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await menu.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByTestId('settings-form')).toBeVisible();
    await page.getByRole('link', { name: '← Back' }).click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
  });

  test('creates a world and opens the game scene', async ({ page }) => {
    await createProfile(page, 'Player One');
    await page.goto('/worlds/new');
    await page.getByTestId('world-name').fill('E2E World');
    await page.getByTestId('world-seed').fill('e2e-seed');
    await page.getByTestId('create-world-submit').click();
    await page.waitForURL(/\/game\?world=/);
    worldUrl = page.url();
    await waitForGame(page);
    await expect(page.getByTestId('world-name')).toHaveText('E2E World');
    await expect(page.getByTestId('hotbar')).toBeVisible();
    await expect(page.getByTestId('crosshair')).toBeVisible();
  });

  test('inventory interactions', async ({ page }) => {
    await createProfile(page, 'Inventory Tester');
    await page.goto(worldUrl);
    await waitForGame(page);
    await page.keyboard.press('KeyE');
    await expect(page.getByTestId('inventory-screen')).toBeVisible();
    await expect(page.getByTestId('creative-palette')).toBeVisible();
    await page.getByTestId('creative-search').fill('glass');
    // Put glass (id 19) into the selected hotbar slot through the server.
    await page.getByTestId('palette-19').click();
    await expect(page.getByTestId('slot-inventory-0').locator('img')).toHaveAttribute('alt', 'Glass');
    // Move it into the main inventory with a click-to-pick-up, click-to-place.
    await page.getByTestId('slot-inventory-0').click();
    await page.getByTestId('slot-inventory-20').click();
    await expect(page.getByTestId('slot-inventory-20').locator('img')).toHaveAttribute('alt', 'Glass');
    await page.getByTestId('close-inventory').click();
    await expect(page.getByTestId('inventory-screen')).toBeHidden();
  });

  test('basic movement controls', async ({ page }) => {
    await createProfile(page, 'Mover');
    await page.goto(worldUrl);
    await waitForGame(page);
    const coords = page.getByTestId('coordinates');
    const before = await coords.textContent();
    // Double-tap jump to fly (Creative), then fly forward so terrain cannot block.
    await page.keyboard.press('Space');
    await page.keyboard.down('Space');
    await page.waitForTimeout(800);
    await page.keyboard.up('Space');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    await expect(coords).not.toHaveText(before ?? '');
    await page.keyboard.press('Digit3');
    await expect(page.locator('[aria-label="Hotbar slot 3"]')).toHaveAttribute('data-selected', 'true');
  });

  test('two players see each other and chat', async ({ browser }) => {
    const one = await browser.newContext();
    const two = await browser.newContext();
    const a = await one.newPage();
    const b = await two.newPage();
    await createProfile(a, 'Host Player');
    await createProfile(b, 'Guest Player');
    await a.goto(worldUrl);
    await waitForGame(a);

    // The guest joins from the lobby list and sees the live player count.
    await b.goto('/multiplayer');
    const card = b.locator('[data-testid=world-card][data-world-name="E2E World"]');
    await expect(card.getByTestId('player-count')).toHaveText(/^1\//);
    await card.getByTestId('join-world').click();
    await waitForGame(b);
    await expect(a.getByTestId('hud-player-count')).toHaveText('2');
    await expect(b.getByTestId('hud-player-count')).toHaveText('2');

    await b.keyboard.press('KeyT');
    await b.getByTestId('chat-input').fill('hello from the guest');
    await b.keyboard.press('Enter');
    await expect(a.getByTestId('chat')).toContainText('hello from the guest');

    // Leaving updates the other player's view.
    await b.close();
    await expect(a.getByTestId('hud-player-count')).toHaveText('1');
    await one.close();
    await two.close();
  });
});
