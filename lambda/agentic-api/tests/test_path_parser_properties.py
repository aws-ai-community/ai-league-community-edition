"""Property-based tests for the path_parser module.

Uses hypothesis to verify round-trip correctness properties of the path
parsing logic across a wide range of valid coordinate lists.

**Validates: Requirements 9.2, 15.3**
"""

import json
import sys
import os

# Add parent directory to path so we can import path_parser and prompt_formatter
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hypothesis import given, settings
from hypothesis import strategies as st

from path_parser import parse_navigation_path
from prompt_formatter import coords_to_label


# Strategy: lists of (row, col) tuples with row, col in [0, 25]
coord_lists = st.lists(
    st.tuples(st.integers(0, 25), st.integers(0, 25)),
    min_size=2,
    max_size=30,
)


class TestPathParsingRoundTripJsonArray:
    """Property 7: Path Parsing Round-Trip (JSON Array).

    For any list of (row, col) tuples with row, col in [0, 25], format as
    JSON [[r, c], ...] and verify parse_navigation_path produces the original
    list of tuples.

    **Validates: Requirements 9.2, 15.3**
    """

    @given(coords=coord_lists)
    @settings(max_examples=100)
    def test_json_array_round_trip(self, coords):
        """Formatting coords as [[r,c],...] and parsing should yield original."""
        # Format as JSON array of [row, col] pairs
        json_array = json.dumps([[r, c] for r, c in coords])

        # Parse the JSON array string
        result = parse_navigation_path(json_array)

        # Verify the result matches the original tuples
        assert result is not None, (
            f"parse_navigation_path returned None for input: {json_array}"
        )
        assert result == list(coords), (
            f"Round-trip failed.\n"
            f"  Input tuples: {coords}\n"
            f"  JSON string:  {json_array}\n"
            f"  Parsed result: {result}"
        )


class TestPathParsingRoundTripCoordinateLabel:
    """Property 8: Path Parsing Round-Trip (Coordinate Label).

    For any list of (row, col) tuples with row, col in [0, 25], convert each
    to a coordinate label using coords_to_label, format as JSON array of
    strings, and verify parse_navigation_path produces the original tuples.

    **Validates: Requirements 9.2, 15.3**
    """

    @given(coords=coord_lists)
    @settings(max_examples=100)
    def test_coordinate_label_round_trip(self, coords):
        """Formatting coords as labels ["A1","B2",...] and parsing should yield original."""
        # Convert each (row, col) to a coordinate label
        labels = [coords_to_label(r, c) for r, c in coords]

        # Format as JSON array of label strings
        json_labels = json.dumps(labels)

        # Parse the JSON label array string
        result = parse_navigation_path(json_labels)

        # Verify the result matches the original tuples
        assert result is not None, (
            f"parse_navigation_path returned None for input: {json_labels}"
        )
        assert result == list(coords), (
            f"Round-trip failed.\n"
            f"  Input tuples: {coords}\n"
            f"  Labels:       {labels}\n"
            f"  JSON string:  {json_labels}\n"
            f"  Parsed result: {result}"
        )
