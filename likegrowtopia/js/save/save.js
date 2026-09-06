// ============================================================================
// Save/load via localStorage. Single-player for now; the payload shape is
// deliberately a plain JSON-able object so a server endpoint can later own
// persistence without changing call sites.
// ============================================================================

const KEY = 'lumenvale_save_v1';

export function saveGame(world, player, inventory) {
  const payload = {
    version: 1,
    savedAt: Date.now(),
    seed: world.seed,
    mods: world.serializeMods(),
    player: player.serialize(),
    inventory: inventory.serialize(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Load failed:', e);
    return null;
  }
}

export function hasSave() {
  return localStorage.getItem(KEY) !== null;
}

export function clearSave() {
  localStorage.removeItem(KEY);
}
