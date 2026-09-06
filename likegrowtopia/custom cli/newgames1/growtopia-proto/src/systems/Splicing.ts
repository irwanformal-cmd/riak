import { findRecipe, markDiscovered, getAllRecipes, RECIPES } from '../data/recipes';
import { ITEMS, getItem, getRarityColor } from '../data/items';

export interface SpliceResult {
  success: boolean;
  outputItemId: string | null;
  message: string;
  isNewDiscovery: boolean;
}

export class SplicingSystem {
  private onDiscoveryCallbacks: ((itemId: string) => void)[] = [];

  onDiscovery(cb: (itemId: string) => void): () => void {
    this.onDiscoveryCallbacks.push(cb);
    return () => {
      const idx = this.onDiscoveryCallbacks.indexOf(cb);
      if (idx >= 0) this.onDiscoveryCallbacks.splice(idx, 1);
    };
  }

  trySplice(seedA: string, seedB: string): SpliceResult {
    // Validate both are seeds
    const itemA = getItem(seedA);
    const itemB = getItem(seedB);

    if (!itemA || !itemB) {
      return { success: false, outputItemId: null, message: 'Invalid items!', isNewDiscovery: false };
    }
    if (itemA.type !== 'seed' || itemB.type !== 'seed') {
      return { success: false, outputItemId: null, message: 'Only seeds can be spliced!', isNewDiscovery: false };
    }

    const recipe = findRecipe(seedA, seedB);
    if (!recipe) {
      // Failed splice - give trash
      return {
        success: true,
        outputItemId: 'dirt_seed',
        message: 'Splice failed! You got a Dirt Seed.',
        isNewDiscovery: false,
      };
    }

    // Success!
    markDiscovered(seedA, seedB);
    const isNew = !recipe.discovered; // Actually it's now true, but we track first discovery
    const outputItem = getItem(recipe.output);

    this.onDiscoveryCallbacks.forEach(cb => cb(recipe.output));

    return {
      success: true,
      outputItemId: recipe.output,
      message: `Discovered: ${outputItem?.name ?? recipe.output}!`,
      isNewDiscovery: true,
    };
  }

  getAvailableRecipes() {
    return getAllRecipes();
  }

  getDiscoveredCount(): number {
    return RECIPES.filter(r => r.discovered).length;
  }

  getTotalRecipes(): number {
    return RECIPES.length;
  }

  // For UI: get possible outputs for a given seed
  getPossibleOutputs(seedId: string): Array<{ output: string; otherInput: string }> {
    const results: Array<{ output: string; otherInput: string }> = [];
    for (const recipe of RECIPES) {
      if (recipe.input[0] === seedId) {
        results.push({ output: recipe.output, otherInput: recipe.input[1] });
      } else if (recipe.input[1] === seedId) {
        results.push({ output: recipe.output, otherInput: recipe.input[0] });
      }
    }
    return results;
  }
}