"""Property-based tests for the Challenge Grader module.

Tests Properties 3-6 from the design document using Hypothesis.
"""

import json
import sys
import os

# Add parent directory to path so we can import challenge_grader
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from hypothesis import given, assume, settings
from hypothesis import strategies as st

from challenge_grader import grade_response, BLOCKED_INDICATORS


# =============================================================================
# Property 3: exact_match grading correctness
# Validates: Requirements 4.2
# =============================================================================


class TestExactMatchProperty:
    """Property 3: exact_match returns True iff response.strip().lower() == expected.strip().lower()"""

    @given(response=st.text(), expected=st.text())
    def test_exact_match_iff_stripped_lower_equal(self, response, expected):
        """
        **Validates: Requirements 4.2**

        For any two strings, exact_match returns True if and only if
        response.strip().lower() == expected.strip().lower().
        """
        result = grade_response(response, expected, "exact_match", "c1")
        expected_result = response.strip().lower() == expected.strip().lower()
        assert result == expected_result

    @given(base=st.text(min_size=1))
    def test_exact_match_ignores_leading_trailing_whitespace(self, base):
        """
        **Validates: Requirements 4.2**

        Adding whitespace to either side should not affect the match result.
        """
        padded = "  \t" + base + "  \n"
        result = grade_response(padded, base, "exact_match", "c1")
        assert result is True

    @given(base=st.text(min_size=1, alphabet="abcdefghijklmnopqrstuvwxyz0123456789"))
    def test_exact_match_ignores_case(self, base):
        """
        **Validates: Requirements 4.2**

        Changing case should not affect the match result (ASCII).
        """
        result = grade_response(base.upper(), base.lower(), "exact_match", "c1")
        assert result is True


# =============================================================================
# Property 4: contains_match grading correctness
# Validates: Requirements 4.3
# =============================================================================


class TestContainsMatchProperty:
    """Property 4: contains_match returns True iff expected.lower() is a substring of response.lower()"""

    @given(response=st.text(), expected=st.text())
    def test_contains_match_iff_substring(self, response, expected):
        """
        **Validates: Requirements 4.3**

        For any two strings, contains_match returns True if and only if
        expected.lower() is a substring of response.lower().
        """
        result = grade_response(response, expected, "contains_match", "c1")
        expected_result = expected.lower() in response.lower()
        assert result == expected_result

    @given(
        prefix=st.text(),
        expected=st.text(min_size=1),
        suffix=st.text(),
    )
    def test_contains_match_wrapping_expected_always_true(self, prefix, expected, suffix):
        """
        **Validates: Requirements 4.3**

        Wrapping expected in a prefix and suffix always returns True.
        """
        response = prefix + expected + suffix
        result = grade_response(response, expected, "contains_match", "c1")
        assert result is True

    @given(
        response=st.text(
            min_size=1,
            alphabet=st.characters(whitelist_categories=("L",), whitelist_characters="abc"),
        ),
    )
    def test_contains_match_completely_different_string_returns_false(self, response):
        """
        **Validates: Requirements 4.3**

        A completely different string (no overlap) returns False.
        """
        # Use a string that cannot appear in a response made of 'abc' letters
        expected = "xyz123"
        assume(expected.lower() not in response.lower())
        result = grade_response(response, expected, "contains_match", "c1")
        assert result is False


# =============================================================================
# Property 5: json_exact_match grading correctness
# Validates: Requirements 4.4
# =============================================================================


# Strategy for generating valid JSON values
json_primitives = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-(2**53), max_value=2**53),
    st.floats(allow_nan=False, allow_infinity=False),
    st.text(max_size=50),
)

json_values = st.recursive(
    json_primitives,
    lambda children: st.one_of(
        st.lists(children, max_size=5),
        st.dictionaries(st.text(max_size=10), children, max_size=5),
    ),
    max_leaves=20,
)


class TestJsonExactMatchProperty:
    """Property 5: json_exact_match grading correctness"""

    @given(value=json_values)
    def test_json_round_trip_returns_true(self, value):
        """
        **Validates: Requirements 4.4**

        For any valid JSON value, serializing it and grading against
        the original serialized form returns True.
        """
        serialized = json.dumps(value)
        result = grade_response(serialized, serialized, "json_exact_match", "c1")
        assert result is True

    @given(invalid_json=st.text().filter(lambda s: _is_invalid_json(s)))
    def test_json_invalid_response_returns_false(self, invalid_json):
        """
        **Validates: Requirements 4.4**

        Invalid JSON strings as response return False.
        """
        valid_expected = json.dumps({"key": "value"})
        result = grade_response(invalid_json, valid_expected, "json_exact_match", "c1")
        assert result is False

    @given(value1=json_values, value2=json_values)
    def test_json_structurally_different_returns_false(self, value1, value2):
        """
        **Validates: Requirements 4.4**

        Structurally different JSON values return False.
        """
        assume(value1 != value2)
        serialized1 = json.dumps(value1)
        serialized2 = json.dumps(value2)
        result = grade_response(serialized1, serialized2, "json_exact_match", "c1")
        assert result is False


# =============================================================================
# Property 6: guardrail_block grading correctness
# Validates: Requirements 4.5
# =============================================================================


class TestGuardrailBlockProperty:
    """Property 6: guardrail_block grading correctness"""

    @given(
        whitespace=st.lists(
            st.sampled_from([" ", "\t", "\n", "\r"]),
            max_size=20,
        ).map("".join)
    )
    def test_guardrail_empty_whitespace_returns_true(self, whitespace):
        """
        **Validates: Requirements 4.5**

        Empty or whitespace-only responses return False (no guardrail intervention detected).
        The guardrail must actively block the content for this to count as correct.
        """
        result = grade_response(whitespace, "", "guardrail_block", "c1")
        assert result is False

    @given(
        indicator=st.sampled_from(BLOCKED_INDICATORS),
        prefix=st.text(max_size=20),
        suffix=st.text(max_size=20),
    )
    def test_guardrail_blocked_indicators_return_true(self, indicator, prefix, suffix):
        """
        **Validates: Requirements 4.5**

        Responses containing blocked indicators return True.
        """
        response = prefix + indicator + suffix
        result = grade_response(response, "", "guardrail_block", "c1")
        assert result is True

    @given(
        response=st.text(
            min_size=51,
            alphabet=st.characters(
                whitelist_categories=("L", "N", "P", "Z"),
                blacklist_characters="[]",
            ),
        )
    )
    def test_guardrail_substantive_non_refusal_returns_false(self, response):
        """
        **Validates: Requirements 4.5**

        Substantive non-refusal answers (length > 50, no blocked indicators)
        return False.
        """
        # Ensure the response doesn't contain any blocked indicators
        for indicator in BLOCKED_INDICATORS:
            assume(indicator not in response)
        # Ensure it's not whitespace-only
        assume(response.strip())
        result = grade_response(response, "", "guardrail_block", "c1")
        assert result is False


# =============================================================================
# Helper functions
# =============================================================================


def _is_invalid_json(s: str) -> bool:
    """Return True if s is not valid JSON."""
    try:
        json.loads(s)
        return False
    except (json.JSONDecodeError, ValueError):
        return True
