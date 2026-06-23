"""Score calculator for the Agentic Game Engine.

Computes final score breakdown from game session results including
challenge points, coin points, treasure bonus, lives bonus, and token bonus
(with custom model reduction applied to token penalty).

Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
"""

from __future__ import annotations

from typing import Any, Dict


# ---------------------------------------------------------------------------
# Custom model token penalty reduction table
# ---------------------------------------------------------------------------

_REDUCTION_TABLE: Dict[int, float] = {
    0: 0.0,
    1: 0.50,
    2: 0.70,
    3: 0.85,
    4: 0.92,
}
_REDUCTION_5_PLUS = 0.95


def get_custom_model_reduction(num_custom_models: int) -> float:
    """Return the token penalty reduction percentage for the given number of custom models.

    0 models → 0%, 1 → 50%, 2 → 70%, 3 → 85%, 4 → 92%, 5+ → 95%.
    """
    if num_custom_models < 0:
        return 0.0
    if num_custom_models >= 5:
        return _REDUCTION_5_PLUS
    return _REDUCTION_TABLE.get(num_custom_models, 0.0)


def compute_token_bonus(
    token_bonus_base: float,
    total_tokens: int,
    challenges_visited: int,
    num_custom_models: int = 0,
) -> float:
    """Compute the givenTokenBonus.

    Formula: tokenBonusBase - ((totalTokens / challengesVisited) × (1 - customModelReduction))
    Clamped to [0, tokenBonusBase].

    If challenges_visited is 0, the full token_bonus_base is returned (no penalty).
    """
    if challenges_visited <= 0:
        return max(0.0, token_bonus_base)

    reduction = get_custom_model_reduction(num_custom_models)
    penalty = (total_tokens / challenges_visited) * (1.0 - reduction)
    bonus = token_bonus_base - penalty
    return round(max(0.0, min(bonus, token_bonus_base)))


def compute_final_score(
    challenge_points: float,
    coin_points: float,
    treasure_reached: bool,
    lives_remaining: int,
    total_tokens: int,
    challenges_visited: int,
    custom_model_count: int,
    map_defaults: Dict[str, Any],
) -> Dict[str, float]:
    """Compute the final score breakdown for a completed game session.

    Args:
        challenge_points: Total points earned from correct challenge answers.
        coin_points: Total points earned from collecting c7 coin tiles.
        treasure_reached: Whether the champion reached a treasure tile.
        lives_remaining: Number of lives remaining at end of game.
        total_tokens: Total LLM tokens consumed during the session.
        challenges_visited: Number of challenge tiles visited during the session.
        custom_model_count: Number of custom/fine-tuned models used.
        map_defaults: Dict containing map default values:
            - livesBonusMultiplier (default 250)
            - tokenBonus (default 1000) — this is the tokenBonusBase
            - treasureBonus (default 1000)

    Returns:
        Dict with keys: finalScore, qaScore, lifeBonusScore, givenTokenBonus, treasureBonus
    """
    lives_bonus_multiplier = map_defaults.get("livesBonusMultiplier", 250)
    token_bonus_base = map_defaults.get("tokenBonus", 1000)
    treasure_bonus_value = map_defaults.get("treasureBonus", 1000)

    # QA score is the sum of challenge points and coin points
    qa_score = challenge_points + coin_points

    # Lives bonus
    life_bonus_score = lives_remaining * lives_bonus_multiplier

    # Treasure bonus
    treasure_bonus = treasure_bonus_value if treasure_reached else 0.0

    # Token bonus (with custom model reduction)
    given_token_bonus = compute_token_bonus(
        token_bonus_base=token_bonus_base,
        total_tokens=total_tokens,
        challenges_visited=challenges_visited,
        num_custom_models=custom_model_count,
    )

    # Final score is the sum of all components
    final_score = qa_score + life_bonus_score + given_token_bonus + treasure_bonus

    return {
        "finalScore": final_score,
        "qaScore": qa_score,
        "lifeBonusScore": life_bonus_score,
        "givenTokenBonus": given_token_bonus,
        "treasureBonus": treasure_bonus,
    }
