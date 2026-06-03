"""Property-based tests for the prompt_formatter module.

Uses hypothesis to verify correctness properties of navigation prompt
construction and coordinate label bijection.
"""

import sys
import os
import json

# Add parent directory to path so we can import prompt_formatter
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hypothesis import given, settings
from hypothesis import strategies as st

from prompt_formatter import coords_to_label, label_to_coords, format_navigation_prompt


# ---------------------------------------------------------------------------
# Strategy: generate valid map_data with grid and playerStart
# ---------------------------------------------------------------------------

def valid_map_data_strategy():
    """Generate valid map_data dicts with grid and playerStart fields."""
    return st.fixed_dictionaries({
        "grid": st.lists(
            st.lists(st.integers(min_value=0, max_value=5), min_size=1, max_size=26),
            min_size=1,
            max_size=26,
        ),
        "playerStart": st.fixed_dictionaries({
            "row": st.integers(min_value=0, max_value=25),
            "col": st.integers(min_value=0, max_value=25),
        }),
    })


# ---------------------------------------------------------------------------
# Property 6: Navigation Prompt Construction
# Validates: Requirements 9.1, 15.2
# ---------------------------------------------------------------------------


@given(map_data=valid_map_data_strategy())
@settings(max_examples=100)
def test_property_6_navigation_prompt_contains_map_json(map_data):
    """**Validates: Requirements 9.1, 15.2**

    For any valid map_data with grid and playerStart, the navigation prompt
    SHALL contain JSON(map_data) as a substring.
    """
    prompt = format_navigation_prompt(map_data)
    map_json = json.dumps(map_data)

    assert map_json in prompt, (
        f"Navigation prompt does not contain JSON(map_data).\n"
        f"Expected substring: {map_json[:100]}...\n"
        f"Prompt: {prompt[:200]}..."
    )


@given(map_data=valid_map_data_strategy())
@settings(max_examples=100)
def test_property_6_navigation_prompt_contains_correct_coordinate_label(map_data):
    """**Validates: Requirements 9.1, 15.2**

    For any valid map_data with grid and playerStart, the navigation prompt
    SHALL contain the correct coordinate label for the player start position.
    """
    prompt = format_navigation_prompt(map_data)
    player_start = map_data["playerStart"]
    expected_label = coords_to_label(player_start["row"], player_start["col"])

    assert expected_label in prompt, (
        f"Navigation prompt does not contain start label '{expected_label}'.\n"
        f"playerStart: row={player_start['row']}, col={player_start['col']}\n"
        f"Prompt: {prompt[:200]}..."
    )


# ---------------------------------------------------------------------------
# Property 9: Coordinate Label Bijection
# Validates: Requirements 9.1, 15.2
# ---------------------------------------------------------------------------


@given(
    row=st.integers(min_value=0, max_value=25),
    col=st.integers(min_value=0, max_value=25),
)
@settings(max_examples=100)
def test_property_9_coords_to_label_then_label_to_coords_round_trip(row, col):
    """**Validates: Requirements 9.1, 15.2**

    For any row in [0,25] and col in [0,25], converting to a label via
    coords_to_label and back via label_to_coords SHALL produce the
    original (row, col) pair.
    """
    label = coords_to_label(row, col)
    result = label_to_coords(label)

    assert result is not None, (
        f"label_to_coords('{label}') returned None for row={row}, col={col}"
    )
    assert result == (row, col), (
        f"Round-trip failed: coords_to_label({row}, {col}) = '{label}', "
        f"label_to_coords('{label}') = {result}, expected ({row}, {col})"
    )
