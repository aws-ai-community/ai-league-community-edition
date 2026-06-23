"""Property-based tests for the score calculator module.

Uses hypothesis to verify correctness properties of the scoring system
across a wide range of valid inputs.
"""

import sys
import os

# Add parent directory to path so we can import score_calculator
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from score_calculator import compute_final_score, compute_token_bonus, get_custom_model_reduction


# ---------------------------------------------------------------------------
# Property 11: Final score is sum of components
# Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
# ---------------------------------------------------------------------------


@given(
    challenge_points=st.integers(min_value=0, max_value=10000),
    coin_points=st.integers(min_value=0, max_value=5000),
    treasure_reached=st.booleans(),
    lives_remaining=st.integers(min_value=0, max_value=5),
    total_tokens=st.integers(min_value=0, max_value=5000),
    challenges_visited=st.integers(min_value=0, max_value=20),
    custom_model_count=st.integers(min_value=0, max_value=10),
    lives_bonus_multiplier=st.integers(min_value=100, max_value=500),
    token_bonus=st.integers(min_value=500, max_value=2000),
    treasure_bonus_value=st.integers(min_value=500, max_value=2000),
)
@settings(max_examples=200)
def test_property_11_final_score_is_sum_of_components(
    challenge_points,
    coin_points,
    treasure_reached,
    lives_remaining,
    total_tokens,
    challenges_visited,
    custom_model_count,
    lives_bonus_multiplier,
    token_bonus,
    treasure_bonus_value,
):
    """**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

    For any completed game session, the finalScore SHALL equal
    qaScore + lifeBonusScore + givenTokenBonus + treasureBonus,
    where lifeBonusScore = livesRemaining × livesBonusMultiplier.
    """
    map_defaults = {
        "livesBonusMultiplier": lives_bonus_multiplier,
        "tokenBonus": token_bonus,
        "treasureBonus": treasure_bonus_value,
    }

    result = compute_final_score(
        challenge_points=challenge_points,
        coin_points=coin_points,
        treasure_reached=treasure_reached,
        lives_remaining=lives_remaining,
        total_tokens=total_tokens,
        challenges_visited=challenges_visited,
        custom_model_count=custom_model_count,
        map_defaults=map_defaults,
    )

    # Verify the final score is the sum of all components
    expected_final = (
        result["qaScore"]
        + result["lifeBonusScore"]
        + result["givenTokenBonus"]
        + result["treasureBonus"]
    )
    assert result["finalScore"] == expected_final, (
        f"finalScore ({result['finalScore']}) != "
        f"qaScore ({result['qaScore']}) + lifeBonusScore ({result['lifeBonusScore']}) + "
        f"givenTokenBonus ({result['givenTokenBonus']}) + treasureBonus ({result['treasureBonus']}) "
        f"= {expected_final}"
    )

    # Verify lifeBonusScore = livesRemaining × livesBonusMultiplier
    expected_life_bonus = lives_remaining * lives_bonus_multiplier
    assert result["lifeBonusScore"] == expected_life_bonus, (
        f"lifeBonusScore ({result['lifeBonusScore']}) != "
        f"livesRemaining ({lives_remaining}) × livesBonusMultiplier ({lives_bonus_multiplier}) "
        f"= {expected_life_bonus}"
    )

    # Verify qaScore = challenge_points + coin_points
    expected_qa = challenge_points + coin_points
    assert result["qaScore"] == expected_qa, (
        f"qaScore ({result['qaScore']}) != "
        f"challenge_points ({challenge_points}) + coin_points ({coin_points}) = {expected_qa}"
    )

    # Verify treasureBonus is correct
    expected_treasure = treasure_bonus_value if treasure_reached else 0.0
    assert result["treasureBonus"] == expected_treasure, (
        f"treasureBonus ({result['treasureBonus']}) != expected ({expected_treasure})"
    )


# ---------------------------------------------------------------------------
# Property 12: Token bonus formula with clamping
# Validates: Requirements 6.6, 6.8
# ---------------------------------------------------------------------------


@given(
    token_bonus_base=st.integers(min_value=0, max_value=2000),
    total_tokens=st.integers(min_value=0, max_value=10000),
    challenges_visited=st.integers(min_value=1, max_value=50),
    num_custom_models=st.integers(min_value=0, max_value=10),
)
@settings(max_examples=200)
def test_property_12_token_bonus_formula_with_challenges(
    token_bonus_base,
    total_tokens,
    challenges_visited,
    num_custom_models,
):
    """**Validates: Requirements 6.6, 6.8**

    When challengesVisited > 0, the token bonus SHALL equal:
    max(0, min(tokenBonusBase, tokenBonusBase - ((totalTokens / challengesVisited) × (1 - customModelReduction))))
    """
    result = compute_token_bonus(
        token_bonus_base=token_bonus_base,
        total_tokens=total_tokens,
        challenges_visited=challenges_visited,
        num_custom_models=num_custom_models,
    )

    reduction = get_custom_model_reduction(num_custom_models)
    penalty = (total_tokens / challenges_visited) * (1.0 - reduction)
    expected = max(0.0, min(float(token_bonus_base), float(token_bonus_base) - penalty))

    assert abs(result - round(expected)) < 1e-9, (
        f"Token bonus ({result}) != expected ({expected}) for "
        f"base={token_bonus_base}, tokens={total_tokens}, "
        f"visited={challenges_visited}, models={num_custom_models}"
    )


@given(
    token_bonus_base=st.integers(min_value=0, max_value=2000),
    total_tokens=st.integers(min_value=0, max_value=10000),
    num_custom_models=st.integers(min_value=0, max_value=10),
)
@settings(max_examples=200)
def test_property_12_token_bonus_full_when_no_challenges(
    token_bonus_base,
    total_tokens,
    num_custom_models,
):
    """**Validates: Requirements 6.6, 6.8**

    When challengesVisited == 0, the token bonus SHALL equal tokenBonusBase.
    """
    result = compute_token_bonus(
        token_bonus_base=token_bonus_base,
        total_tokens=total_tokens,
        challenges_visited=0,
        num_custom_models=num_custom_models,
    )

    expected = max(0.0, float(token_bonus_base))
    assert result == expected, (
        f"Token bonus ({result}) != tokenBonusBase ({expected}) "
        f"when challengesVisited == 0"
    )


@given(
    token_bonus_base=st.integers(min_value=0, max_value=2000),
    total_tokens=st.integers(min_value=0, max_value=10000),
    challenges_visited=st.integers(min_value=0, max_value=50),
    num_custom_models=st.integers(min_value=0, max_value=10),
)
@settings(max_examples=200)
def test_property_12_token_bonus_always_in_range(
    token_bonus_base,
    total_tokens,
    challenges_visited,
    num_custom_models,
):
    """**Validates: Requirements 6.6, 6.8**

    The token bonus SHALL always be in the range [0, tokenBonusBase].
    """
    result = compute_token_bonus(
        token_bonus_base=token_bonus_base,
        total_tokens=total_tokens,
        challenges_visited=challenges_visited,
        num_custom_models=num_custom_models,
    )

    assert result >= 0.0, f"Token bonus ({result}) is negative"
    assert result <= token_bonus_base, (
        f"Token bonus ({result}) exceeds tokenBonusBase ({token_bonus_base})"
    )


# ---------------------------------------------------------------------------
# Property 13: Custom model reduction lookup
# Validates: Requirements 6.7
# ---------------------------------------------------------------------------


@given(n=st.integers(min_value=-5, max_value=100))
@settings(max_examples=200)
def test_property_13_custom_model_reduction_lookup(n):
    """**Validates: Requirements 6.7**

    For any integer n:
    - Negative inputs return 0.0
    - 0 → 0.0, 1 → 0.50, 2 → 0.70, 3 → 0.85, 4 → 0.92, 5+ → 0.95
    """
    result = get_custom_model_reduction(n)

    if n < 0:
        assert result == 0.0, f"Negative input {n} should return 0.0, got {result}"
    elif n == 0:
        assert result == 0.0, f"n=0 should return 0.0, got {result}"
    elif n == 1:
        assert result == 0.50, f"n=1 should return 0.50, got {result}"
    elif n == 2:
        assert result == 0.70, f"n=2 should return 0.70, got {result}"
    elif n == 3:
        assert result == 0.85, f"n=3 should return 0.85, got {result}"
    elif n == 4:
        assert result == 0.92, f"n=4 should return 0.92, got {result}"
    else:  # n >= 5
        assert result == 0.95, f"n={n} (>=5) should return 0.95, got {result}"
