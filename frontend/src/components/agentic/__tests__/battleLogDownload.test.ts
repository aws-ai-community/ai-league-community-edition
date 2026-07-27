import { describe, it, expect } from 'vitest';

/**
 * Tests for battle log download format — verifies the exported JSON matches
 * the real AWS AI League game's battle log structure.
 *
 * Reference: personal/ai-league/2026/Atos-Practice-July-2026/Reference/nova-with-dummy-custom-models.json
 */

// Extracted from GameplayPage.tsx — the formatting logic for battle log export
interface GameEvent {
  type: string;
  position?: { row: number; col: number };
  message?: string;
  challengeId?: string;
  challengeName?: string;
  challengePoints?: number;
  points?: number;
  damage?: number;
  finalScore?: number;
  qaScore?: number;
  challengeScore?: number;
  lifeBonusScore?: number;
  givenTokenBonus?: number;
  treasureBonus?: number;
  livesRemaining?: number;
  coinBonus?: number;
  challengesAttempted?: number;
  tokensUsed?: number;
  customModelCount?: number;
  scoreAfter?: number;
  livesAfter?: number;
}

function formatBattleLogEvent(e: GameEvent, timer: number, timeLimit: number): Record<string, unknown> {
  const out: Record<string, unknown> = { type: e.type };
  if (e.message !== undefined) out.message = e.message;
  if (e.position) out.position = e.position;
  if (e.challengeId) out.challengeId = e.challengeId;
  if (e.challengeName) out.challengeName = e.challengeName;
  if (e.challengePoints !== undefined) out.challengePoints = e.challengePoints;
  if (e.points !== undefined) out.points = e.points;
  if (e.damage !== undefined) out.damage = e.damage;
  if (e.type === 'ScoreSummary') {
    out.livesRemaining = e.livesRemaining ?? 0;
    out.lifeBonus = e.lifeBonusScore ?? 0;
    out.coinsEarned = (e.coinBonus ?? 0) + (e.challengeScore ?? e.qaScore ?? 0);
    out.tokensUsed = e.tokensUsed ?? 0;
    out.challengesAttempted = e.challengesAttempted ?? 0;
    out.avgTokensPerChallenge = (e.challengesAttempted ?? 0) > 0
      ? Math.round((e.tokensUsed ?? 0) / (e.challengesAttempted ?? 1))
      : 0;
    out.tokenBonus = Math.round(e.givenTokenBonus ?? 0);
    out.treasureBonus = e.treasureBonus ?? 0;
    out.totalScore = e.finalScore ?? 0;
    out.customModelCount = e.customModelCount ?? 0;
  }
  if (e.type === 'WinGame' && e.points !== undefined) {
    out.timeElapsed = timeLimit - timer;
  }
  return out;
}

function formatBattleLog(events: GameEvent[], timer: number, timeLimit: number) {
  const formattedEvents = events.map((e) => formatBattleLogEvent(e, timer, timeLimit));

  const summaryEvent = events.find((e) => e.type === 'ScoreSummary');
  const mins = Math.floor(timer / 60);
  const secs = timer % 60;
  const timeRemaining = `${mins}:${secs.toString().padStart(2, '0')}`;

  const summary = summaryEvent ? {
    timeRemaining,
    livesRemaining: summaryEvent.livesRemaining ?? 0,
    lifeBonus: summaryEvent.lifeBonusScore ?? 0,
    coinsEarned: (summaryEvent.coinBonus ?? 0) + (summaryEvent.challengeScore ?? summaryEvent.qaScore ?? 0),
    treasureBonus: summaryEvent.treasureBonus ?? 0,
    totalScore: summaryEvent.finalScore ?? 0,
    tokensUsed: summaryEvent.tokensUsed ?? 0,
    challengesAttempted: summaryEvent.challengesAttempted ?? 0,
    avgTokensPerChallenge: (summaryEvent.challengesAttempted ?? 0) > 0
      ? Math.round((summaryEvent.tokensUsed ?? 0) / (summaryEvent.challengesAttempted ?? 1))
      : 0,
    tokenBonus: Math.round(summaryEvent.givenTokenBonus ?? 0),
  } : undefined;

  return { events: formattedEvents, ...(summary ? { summary } : {}) };
}

// ============================================================
// Tests
// ============================================================

describe('Battle Log Download Format', () => {

  it('produces top-level "events" and "summary" keys matching real game', () => {
    const events: GameEvent[] = [
      { type: 'InputPrompt', message: 'test prompt', position: { row: 0, col: 0 } },
      { type: 'MoveSpace', position: { row: 0, col: 1 } },
      { type: 'ScoreSummary', position: { row: 9, col: 9 }, livesRemaining: 4, lifeBonusScore: 1000, coinBonus: 2000, challengeScore: 5000, givenTokenBonus: 500, treasureBonus: 1000, finalScore: 9500, challengesAttempted: 10, tokensUsed: 500, customModelCount: 2 },
    ];

    const result = formatBattleLog(events, 176, 300);

    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('summary');
    expect(Array.isArray(result.events)).toBe(true);
  });

  it('MoveSpace events have only type and position', () => {
    const events: GameEvent[] = [
      { type: 'MoveSpace', position: { row: 3, col: 5 } },
    ];

    const result = formatBattleLog(events, 180, 300);
    const move = result.events[0];

    expect(move).toEqual({ type: 'MoveSpace', position: { row: 3, col: 5 } });
    expect(Object.keys(move)).toHaveLength(2);
  });

  it('AskChallenge events include message, challengeId, and position', () => {
    const events: GameEvent[] = [
      { type: 'AskChallenge', message: 'What is 2+2?', challengeId: 'c5', position: { row: 2, col: 3 } },
    ];

    const result = formatBattleLog(events, 180, 300);
    const ask = result.events[0];

    expect(ask.type).toBe('AskChallenge');
    expect(ask.message).toBe('What is 2+2?');
    expect(ask.challengeId).toBe('c5');
    expect(ask.position).toEqual({ row: 2, col: 3 });
  });

  it('WinChallenge events include challengeId, challengePoints, and points', () => {
    const events: GameEvent[] = [
      { type: 'WinChallenge', challengeId: 'c5', challengePoints: 250, points: 250, position: { row: 2, col: 3 } },
    ];

    const result = formatBattleLog(events, 180, 300);
    const win = result.events[0];

    expect(win.challengeId).toBe('c5');
    expect(win.challengePoints).toBe(250);
    expect(win.points).toBe(250);
  });

  it('WinNonPromptChallenge includes challengeId, challengeName, damage, and points', () => {
    const events: GameEvent[] = [
      { type: 'WinNonPromptChallenge', challengeId: 'c7', challengeName: 'some Coins', damage: 0, points: 250, position: { row: 4, col: 3 } },
    ];

    const result = formatBattleLog(events, 180, 300);
    const coin = result.events[0];

    expect(coin.challengeId).toBe('c7');
    expect(coin.challengeName).toBe('some Coins');
    expect(coin.damage).toBe(0);
    expect(coin.points).toBe(250);
  });

  it('LoseNonPromptChallenge includes damage and zero points', () => {
    const events: GameEvent[] = [
      { type: 'LoseNonPromptChallenge', challengeId: 'c8', challengeName: 'a Spike trap', damage: 1, points: 0, position: { row: 4, col: 8 } },
    ];

    const result = formatBattleLog(events, 180, 300);
    const spike = result.events[0];

    expect(spike.damage).toBe(1);
    expect(spike.points).toBe(0);
  });

  it('WinGame event includes timeElapsed calculated from timer', () => {
    const events: GameEvent[] = [
      { type: 'WinGame', points: 1000, position: { row: 9, col: 9 } },
    ];

    // Timer at 175s remaining, time limit 300s → elapsed = 125s
    const result = formatBattleLog(events, 175, 300);
    const win = result.events[0];

    expect(win.timeElapsed).toBe(125);
    expect(win.points).toBe(1000);
  });

  it('ScoreSummary matches real game field names', () => {
    const events: GameEvent[] = [
      {
        type: 'ScoreSummary',
        position: { row: 9, col: 9 },
        livesRemaining: 4,
        lifeBonusScore: 1000,
        coinBonus: 1750,
        challengeScore: 8950,
        givenTokenBonus: 982,
        treasureBonus: 1000,
        finalScore: 13682,
        challengesAttempted: 17,
        tokensUsed: 1036,
        customModelCount: 2,
      },
    ];

    const result = formatBattleLog(events, 176, 300);
    const summary = result.events[0];

    // Real game fields
    expect(summary.livesRemaining).toBe(4);
    expect(summary.lifeBonus).toBe(1000);
    expect(summary.coinsEarned).toBe(1750 + 8950); // coinBonus + challengeScore
    expect(summary.tokensUsed).toBe(1036);
    expect(summary.challengesAttempted).toBe(17);
    expect(summary.avgTokensPerChallenge).toBe(Math.round(1036 / 17));
    expect(summary.tokenBonus).toBe(982);
    expect(summary.treasureBonus).toBe(1000);
    expect(summary.totalScore).toBe(13682);
    expect(summary.customModelCount).toBe(2);
  });

  it('summary section matches real game structure', () => {
    const events: GameEvent[] = [
      {
        type: 'ScoreSummary',
        position: { row: 9, col: 9 },
        livesRemaining: 4,
        lifeBonusScore: 1000,
        coinBonus: 2000,
        challengeScore: 8700,
        givenTokenBonus: 982,
        treasureBonus: 1000,
        finalScore: 13682,
        challengesAttempted: 17,
        tokensUsed: 1036,
        customModelCount: 2,
      },
    ];

    // 2:56 remaining
    const result = formatBattleLog(events, 176, 300);

    expect(result.summary).toBeDefined();
    expect(result.summary!.timeRemaining).toBe('2:56');
    expect(result.summary!.livesRemaining).toBe(4);
    expect(result.summary!.lifeBonus).toBe(1000);
    expect(result.summary!.treasureBonus).toBe(1000);
    expect(result.summary!.totalScore).toBe(13682);
    expect(result.summary!.tokensUsed).toBe(1036);
    expect(result.summary!.challengesAttempted).toBe(17);
    expect(result.summary!.avgTokensPerChallenge).toBe(61);
    expect(result.summary!.tokenBonus).toBe(982);
  });

  it('no summary when no ScoreSummary event exists', () => {
    const events: GameEvent[] = [
      { type: 'MoveSpace', position: { row: 0, col: 0 } },
    ];

    const result = formatBattleLog(events, 180, 300);

    expect(result.summary).toBeUndefined();
    expect(result).not.toHaveProperty('summary');
  });

  it('does not include undefined/null fields in output', () => {
    const events: GameEvent[] = [
      { type: 'MoveSpace', position: { row: 1, col: 2 } },
      { type: 'AnswerChallenge', message: 'Olympus Mons', position: { row: 2, col: 2 } },
    ];

    const result = formatBattleLog(events, 180, 300);

    // MoveSpace should not have message, challengeId, etc.
    expect(result.events[0]).not.toHaveProperty('message');
    expect(result.events[0]).not.toHaveProperty('challengeId');
    expect(result.events[0]).not.toHaveProperty('points');

    // AnswerChallenge should have message but not challengeId (not set)
    expect(result.events[1]).toHaveProperty('message');
    expect(result.events[1]).not.toHaveProperty('challengeId');
  });
});
