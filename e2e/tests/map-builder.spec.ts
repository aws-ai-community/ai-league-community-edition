import { test, expect } from '@playwright/test';
import { MapBuilderPage } from '../pages/map-builder.page';

test.describe.serial('Map Builder', () => {
  const mapName = `Test Map ${Date.now()}`;

  test('page loads with grid, tile palette, and settings panel visible', async ({ page }) => {
    const mapBuilder = new MapBuilderPage(page);

    await mapBuilder.goto();
    await mapBuilder.verifyGridVisible();
    await mapBuilder.verifyPaletteVisible();
    await mapBuilder.verifySettingsVisible();
  });

  test('drag a tile onto a grid cell and verify it appears', async ({ page }) => {
    const mapBuilder = new MapBuilderPage(page);

    await mapBuilder.goto();

    // Place a treasure tile on the grid
    await mapBuilder.dragTileToCell('Treasure', 2, 2);
    await mapBuilder.verifyCellHasTile(2, 2);
  });

  test('save map with required tiles and verify it appears in saved maps list', async ({ page }) => {
    const mapBuilder = new MapBuilderPage(page);

    await mapBuilder.goto();

    // Place a start/avatar tile (required for validation)
    await mapBuilder.clickTileInPalette('Start');
    await mapBuilder.clickCell(0, 0);

    // Place a treasure tile (required for validation)
    await mapBuilder.clickTileInPalette('Treasure');
    await mapBuilder.clickCell(3, 3);

    // Save the map with a unique name
    await mapBuilder.saveMap(mapName);
    await mapBuilder.verifySaveSuccess();
  });

  test('load the saved map and verify grid matches what was saved', async ({ page }) => {
    const mapBuilder = new MapBuilderPage(page);

    await mapBuilder.goto();

    // Load the previously saved map
    await mapBuilder.loadMap(mapName);
    await mapBuilder.verifyMapLoaded(mapName);

    // Verify tiles are present in the cells where we placed them
    await mapBuilder.verifyCellHasTile(0, 0);
    await mapBuilder.verifyCellHasTile(3, 3);
  });

  test('delete the saved map and verify removed from list', async ({ page }) => {
    const mapBuilder = new MapBuilderPage(page);

    await mapBuilder.goto();

    // Load the map first so it's the active map
    await mapBuilder.loadMap(mapName);
    await mapBuilder.verifyMapLoaded(mapName);

    // Delete it
    await mapBuilder.deleteMap();

    // Verify it no longer appears in the saved maps list
    await mapBuilder.verifyMapDeleted(mapName);
  });
});
