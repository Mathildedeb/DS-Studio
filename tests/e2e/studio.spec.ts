import { test, expect } from '@playwright/test';

test('boucle centrale réelle : diff, validation, propagation, recharge, annulation sélective', async ({
  page,
}) => {
  await page.goto('/#design-system');
  await expect(
    page.getByRole('heading', { name: 'Design System', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText('Figma non connecté', { exact: true }),
  ).toBeVisible();
  // Le DS est vide de composants : la propagation se lit sur les variables
  // de tokens de l'iframe Preview, et sur la liste des tokens.
  const mobile = page.frameLocator('iframe');
  const open = (name: string) =>
    page
      .getByRole('navigation', { name: 'Vues' })
      .getByRole('link', { name, exact: true })
      .click();
  const row = (key: string) =>
    page
      .locator('.token-table tr')
      .filter({ has: page.getByRole('button', { name: key, exact: true }) });
  const cssVar = (name: string) =>
    mobile
      .locator('.ds')
      .evaluate(
        (el, n) => getComputedStyle(el).getPropertyValue(n).trim(),
        name,
      );
  await expect(row('color.brand')).toContainText('#3F3F46');
  await page.getByLabel('Valeur du token').fill('#8A3B20');
  await page.getByRole('button', { name: 'Proposer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('#3F3F46');
  await expect(dialog).toContainText('#8A3B20');
  await dialog.getByRole('button', { name: 'Ne pas appliquer' }).click();
  await expect(row('color.brand')).toContainText('#3F3F46');
  await page.getByRole('button', { name: 'Proposer', exact: true }).click();
  await dialog.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await expect(row('color.brand')).toContainText('#8A3B20');
  await open('Preview');
  await expect.poll(() => cssVar('--color-brand')).toBe('#8A3B20');
  await open('Design System');
  await page.reload();
  await expect(row('color.brand')).toContainText('#8A3B20');
  await page
    .getByRole('combobox', { name: 'Token', exact: true })
    .selectOption('space.md');
  await page.getByLabel('Valeur du token').fill('22');
  await page.getByRole('button', { name: 'Proposer', exact: true }).click();
  await dialog.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await page.getByRole('button', { name: /Historique/ }).click();
  await page
    .getByRole('button', { name: 'Annuler la révision 1', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await expect(row('color.brand')).toContainText('#3F3F46');
  await expect(row('space.md')).toContainText('22px');
  await open('Preview');
  await expect.poll(() => cssVar('--color-brand')).toBe('#3F3F46');
  await expect.poll(() => cssVar('--space-md')).toBe('22px');
  await page.screenshot({ path: 'test-results/studio.png', fullPage: true });
});

test('largeurs réelles, formats et pages de la Preview', async ({ page }) => {
  await page.goto('/#preview');
  const frame = page.frameLocator('iframe');
  const formats = page.getByRole('group', { name: 'Format' });
  const pages = page.getByRole('group', { name: 'Page' });
  // Un format créé à la main rejoint iPhone, Tablette et Desktop.
  await formats.getByRole('button', { name: '+ Format' }).click();
  await page.getByLabel('Nom du format').fill('Compact');
  await page.getByLabel('Largeur (px)').fill('320');
  await page.getByLabel('Hauteur (px)').fill('640');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  for (const [name, width] of [
    ['Compact', 320],
    ['iPhone', 393],
    ['Tablette', 820],
    ['Desktop', 1440],
  ] as const) {
    await formats.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(page.locator('iframe')).toHaveAttribute(
      'width',
      String(width),
    );
    await expect
      .poll(() =>
        page
          .locator('iframe')
          .evaluate((f: HTMLIFrameElement) => f.contentWindow?.innerWidth),
      )
      .toBe(width);
    expect(
      await frame
        .locator('body')
        .evaluate((el) => el.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await expect(frame.getByRole('heading', { name: 'Découvrir' })).toBeVisible();
  await expect(frame.getByText('Page vide.', { exact: false })).toBeVisible();
  // Une page ajoutée s'ouvre vide avec son nom, puis se renomme.
  await pages.getByRole('button', { name: '+ Page' }).click();
  await page.getByLabel('Nom de la page').fill('Profil');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Profil' })).toBeVisible();
  await pages.getByRole('button', { name: 'Renommer' }).click();
  await page.getByLabel('Nouveau nom').fill('Mon profil');
  await page
    .getByRole('button', { name: 'Renommer', exact: true })
    .last()
    .click();
  await expect(
    frame.getByRole('heading', { name: 'Mon profil' }),
  ).toBeVisible();
  await page.reload();
  await expect(pages.getByRole('button', { name: 'Mon profil' })).toBeVisible();
  await page.setViewportSize({ width: 700, height: 900 });
  expect(
    await page
      .locator('body')
      .evaluate((el) => el.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test('entrée couleur invalide sans mutation et clavier du diff', async ({
  page,
}) => {
  await page.goto('/#design-system');
  await page.getByLabel('Valeur du token').fill('red');
  await page.getByRole('button', { name: 'Proposer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Données invalides');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('Valeur du token').fill('#123456');
  await page.getByRole('button', { name: 'Proposer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Ne pas appliquer' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('export navigateur, import valide avec diff, fichier invalide sans écriture', async ({
  page,
}) => {
  await page.goto('/#design-system');
  await expect(
    page.getByRole('heading', { name: 'Tokens sémantiques' }),
  ).toBeVisible();
  const before = await (await page.request.get('/api/state')).json();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter les tokens' }).click();
  const file = await download;
  const { readFile } = await import('node:fs/promises');
  const exported = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(exported).toEqual(before.tokens);
  exported['color.success'].$value = '#125533';
  await page.locator('input[type=file]').setInputFiles({
    name: 'palette.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('color.success');
  expect((await (await page.request.get('/api/state')).json()).revision).toBe(
    before.revision,
  );
  await dialog.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await expect(dialog).not.toBeVisible();
  const after = await (await page.request.get('/api/state')).json();
  expect(after.tokens['color.success'].$value).toBe('#125533');
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{bad'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await page.request.get('/api/state')).json()).revision).toBe(
    after.revision,
  );
});

test('V2 : contraste proposé immédiat sans modifier les composants enregistrés', async ({
  page,
}) => {
  await page.goto('/#design-system');
  await page
    .getByRole('combobox', { name: 'Token', exact: true })
    .selectOption('color.brand');
  await page.getByLabel('Valeur du token').fill('#FFFFFF');
  await expect(
    page.getByText('Contraste proposé :', { exact: false }),
  ).toContainText('1.00:1');
  await expect(
    page.getByText('Contraste proposé :', { exact: false }),
  ).toContainText('Contraste à améliorer');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const current = await (await page.request.get('/api/state')).json();
  expect(current.tokens['color.brand'].$value).not.toBe('#FFFFFF');
});

test('V2 : brief privé persistant, indépendant du mode IA', async ({
  page,
}) => {
  // Le brief vit dans le tableau de bord.
  await page.goto('/');
  await page.getByText('Mon PFE · brief privé', { exact: true }).click();
  await page
    .getByLabel('Nom du PFE', { exact: true })
    .fill('Mon atelier accessible');
  await page
    .getByLabel('Public concerné', { exact: true })
    .fill('Étudiants en mobilité');
  await page
    .getByLabel('Objectif et critères de réussite', { exact: true })
    .fill('Réserver en moins de trois étapes');
  await page.getByRole('button', { name: 'Enregistrer le brief' }).click();
  await expect(page.getByText('Brief enregistré sur ce poste.')).toBeVisible();
  await page.reload();
  await page.getByText('Mon PFE · brief privé', { exact: true }).click();
  await expect(page.getByLabel('Nom du PFE', { exact: true })).toHaveValue(
    'Mon atelier accessible',
  );
});

test('V2 : recherche, brouillon récupéré après recharge et abandon sans écriture', async ({
  page,
}) => {
  await page.goto('/#design-system');
  const before = await (await page.request.get('/api/state')).json();
  await page.getByLabel('Rechercher un token').fill('space');
  await expect(
    page.getByText('3 résultat(s).', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Token', exact: true })
    .selectOption('space.lg');
  await page.getByLabel('Valeur du token').fill('31');
  await expect(
    page.getByText('Brouillon non enregistré.', { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Token', exact: true }),
  ).toHaveValue('space.lg');
  await expect(page.getByLabel('Valeur du token')).toHaveValue('31');
  await expect(
    page.getByText('Brouillon récupéré', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Abandonner le brouillon' }).click();
  await expect(page.getByLabel('Valeur du token')).toHaveValue(
    String(before.tokens['space.lg'].$value),
  );
  expect((await (await page.request.get('/api/state')).json()).revision).toBe(
    before.revision,
  );
});

test('V2 : conflit multi-onglets visible dans le diff, aucune perte de données', async ({
  page,
  context,
}) => {
  await page.goto('/#design-system');
  await page
    .getByRole('combobox', { name: 'Token', exact: true })
    .selectOption('color.brand');
  await page.getByLabel('Valeur du token').fill('#223355');
  await page.getByRole('button', { name: 'Proposer', exact: true }).click();
  const other = await context.newPage();
  await other.goto('/#design-system');
  await other
    .getByRole('combobox', { name: 'Token', exact: true })
    .selectOption('color.brand');
  await other.getByLabel('Valeur du token').fill('#664422');
  await other.getByRole('button', { name: 'Proposer', exact: true }).click();
  await other.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await expect(other.getByRole('dialog')).not.toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Une autre validation');
  await expect(
    dialog.getByRole('button', { name: 'Valider et enregistrer' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Ne pas appliquer' }).click();
  expect(
    (await (await page.request.get('/api/state')).json()).tokens['color.brand']
      .$value,
  ).toBe('#664422');
  await other.close();
});

test('V2 : capacité de session périmée simulée sans rejeu ambigu', async ({
  page,
}) => {
  await page.goto('/#design-system');
  await page.getByRole('heading', { name: 'Tokens sémantiques' }).waitFor();
  const boot = await (await page.request.get('/api/bootstrap')).json();
  // Un seul refus certain avant mutation, comme une capacité périmée après restart.
  let requests = 0;
  await page.route('**/api/proposals', async (route) => {
    requests++;
    if (requests === 1)
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Validation de session manquante. Rechargez la page.',
        }),
      });
    expect(route.request().headers()['x-ds-studio']).toBe(boot.csrf);
    return route.continue();
  });
  await page
    .getByRole('combobox', { name: 'Token', exact: true })
    .selectOption('color.focus');
  await page.getByLabel('Valeur du token').fill('#776622');
  await page.getByRole('button', { name: 'Proposer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(requests).toBe(2);
  await page.keyboard.press('Escape');
});

test('V2 : clavier, mobile 375 px et absence de stockage navigateur', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Stockage refusé');
    };
    Storage.prototype.getItem = () => {
      throw new DOMException('Stockage refusé');
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#design-system');
  await page.getByRole('heading', { name: 'Tokens sémantiques' }).waitFor();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Aller aux tokens' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Design System', exact: true }),
  ).toBeFocused();
  await page.getByLabel('Valeur du token').fill('#114477');
  await page.getByRole('button', { name: 'Proposer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(
    await page.locator('body').evaluate((el) => el.scrollWidth <= innerWidth),
  ).toBe(true);
});

test('V2 : ajouter puis supprimer un token, chaque fois par le diff', async ({
  page,
}) => {
  await page.goto('/#design-system');
  const dialog = page.getByRole('dialog');
  const row = page
    .locator('.token-table tr')
    .filter({ has: page.getByRole('button', { name: 'color.accent' }) });
  await page.getByRole('button', { name: '+ Token' }).click();
  await page.getByLabel('Nom du token').fill('color.accent');
  await page.getByLabel('Type du token').selectOption('color');
  await page.getByLabel('Valeur initiale').fill('#112233');
  await page.getByRole('button', { name: 'Proposer l’ajout' }).click();
  await expect(dialog).toContainText('absent');
  await expect(dialog).toContainText('#112233');
  await dialog.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await expect(row).toContainText('#112233');
  await expect(
    page.getByRole('heading', { name: 'color.accent', level: 2 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer ce token' }).click();
  await expect(dialog).toContainText('supprimé');
  await dialog.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await expect(row).toHaveCount(0);
});
