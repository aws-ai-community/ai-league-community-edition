// Tile sprite imports
import normalSprite from '../../assets/sprites/normal.png';
import wallSprite from '../../assets/sprites/wall.png';
import startSprite from '../../assets/sprites/avatar.png';
import treasureSprite from '../../assets/sprites/treasure.png';
import c1Sprite from '../../assets/sprites/c1.png';
import c2Sprite from '../../assets/sprites/c2.png';
import c3Sprite from '../../assets/sprites/c3.png';
import c4Sprite from '../../assets/sprites/c4.png';
import c5Sprite from '../../assets/sprites/c5.png';
import c6Sprite from '../../assets/sprites/c6.png';
import c7Sprite from '../../assets/sprites/c7.png';
import c8Sprite from '../../assets/sprites/c8.png';
import c17Sprite from '../../assets/sprites/c17.png';
import c18Sprite from '../../assets/sprites/c18.png';
import c30Sprite from '../../assets/sprites/c30.png';
import c31Sprite from '../../assets/sprites/c31.png';
import c32Sprite from '../../assets/sprites/c32.png';
import c33Sprite from '../../assets/sprites/c33.png';
import c40Sprite from '../../assets/sprites/c40.png';
import c41Sprite from '../../assets/sprites/c41.png';
import c42Sprite from '../../assets/sprites/c42.png';
import c43Sprite from '../../assets/sprites/c43.png';

// Tile key type definitions
export type SpecialTile = 'normal' | 'wall' | 'start' | 'treasure';
export type ChallengeTile = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'c17' | 'c18';
export type KeyTile = 'c40' | 'c41' | 'c42' | 'c43';
export type DoorTile = 'c30' | 'c31' | 'c32' | 'c33';
export type TileKey = SpecialTile | ChallengeTile | KeyTile | DoorTile;

// Tile metadata interface
export interface TileMetadata {
  key: TileKey;
  name: string;
  description: string;
  category: 'Special' | 'Challenge' | 'Key' | 'Door';
  points?: number;
  damage?: number;
  requirements?: string;
}

// Complete tile metadata registry
export const TILE_METADATA: Record<TileKey, TileMetadata> = {
  normal: { key: 'normal', name: 'Normal', description: 'Empty walkable floor tile', category: 'Special' },
  wall: { key: 'wall', name: 'Wall', description: 'Impassable wall', category: 'Special' },
  start: { key: 'start', name: 'Start', description: 'Player starting position', category: 'Special' },
  treasure: { key: 'treasure', name: 'Treasure', description: 'Goal - reach to win (+1000 bonus)', category: 'Special', points: 1000, damage: 0 },
  c7: { key: 'c7', name: 'Coins', description: 'Free coins, no challenge required', category: 'Challenge', points: 250, damage: 0 },
  c5: { key: 'c5', name: 'Bonehead', description: 'Simple question that requires little skill', category: 'Challenge', points: 250, damage: 1 },
  c1: { key: 'c1', name: 'Violent Violet', description: 'Guardrail challenge - configure Bedrock Guardrails correctly', category: 'Challenge', points: 400, damage: 1 },
  c18: { key: 'c18', name: 'Healthcare API', description: 'JSON parsing challenge - extract data from API response', category: 'Challenge', points: 500, damage: 1 },
  c3: { key: 'c3', name: 'Memento', description: 'Memory challenge - recall previous conversations', category: 'Challenge', points: 550, damage: 1 },
  c2: { key: 'c2', name: 'Blue Brain', description: 'Code execution challenge - write and run code via Lambda tool', category: 'Challenge', points: 600, damage: 1 },
  c17: { key: 'c17', name: 'Distraction', description: 'Concise response challenge - answer briefly and accurately', category: 'Challenge', points: 750, damage: 1 },
  c4: { key: 'c4', name: 'Dark Prophet', description: 'Web scraping challenge - retrieve information from the internet', category: 'Challenge', points: 800, damage: 1 },
  c6: { key: 'c6', name: 'Boss', description: 'Boss challenge - requires all skills to defeat', category: 'Challenge', points: 1000, damage: 1 },
  c8: { key: 'c8', name: 'Spikes', description: 'Hazard - reduces health when traversed, no challenge', category: 'Challenge', points: 0, damage: 1 },
  c40: { key: 'c40', name: 'Red Key', description: 'Collect to unlock Red Door', category: 'Key', points: 50, damage: 1 },
  c41: { key: 'c41', name: 'Green Key', description: 'Collect to unlock Green Door', category: 'Key', points: 50, damage: 1 },
  c42: { key: 'c42', name: 'Grey Key', description: 'Collect to unlock Grey Door', category: 'Key', points: 50, damage: 1 },
  c43: { key: 'c43', name: 'Yellow Key', description: 'Collect to unlock Yellow Door', category: 'Key', points: 50, damage: 1 },
  c30: { key: 'c30', name: 'Red Door', description: 'Locked door - pass with Red Key for points, -5 damage without', category: 'Door', points: 1000, damage: 5, requirements: 'Requires Red Key (c40)' },
  c31: { key: 'c31', name: 'Green Door', description: 'Locked door - pass with Green Key for points, -5 damage without', category: 'Door', points: 1000, damage: 5, requirements: 'Requires Green Key (c41)' },
  c32: { key: 'c32', name: 'Grey Door', description: 'Locked door - pass with Grey Key for points, -5 damage without', category: 'Door', points: 1000, damage: 5, requirements: 'Requires Grey Key (c42)' },
  c33: { key: 'c33', name: 'Yellow Door', description: 'Locked door - pass with Yellow Key for points, -5 damage without', category: 'Door', points: 1000, damage: 5, requirements: 'Requires Yellow Key (c43)' },
};

// Sprite image mapping for each tile key
export const TILE_SPRITES: Record<TileKey, string> = {
  normal: normalSprite,
  wall: wallSprite,
  start: startSprite,
  treasure: treasureSprite,
  c1: c1Sprite,
  c2: c2Sprite,
  c3: c3Sprite,
  c4: c4Sprite,
  c5: c5Sprite,
  c6: c6Sprite,
  c7: c7Sprite,
  c8: c8Sprite,
  c17: c17Sprite,
  c18: c18Sprite,
  c30: c30Sprite,
  c31: c31Sprite,
  c32: c32Sprite,
  c33: c33Sprite,
  c40: c40Sprite,
  c41: c41Sprite,
  c42: c42Sprite,
  c43: c43Sprite,
};

// Array of all valid tile keys
export const ALL_TILE_KEYS: TileKey[] = Object.keys(TILE_METADATA) as TileKey[];
