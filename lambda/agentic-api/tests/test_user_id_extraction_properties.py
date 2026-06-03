"""Property-based tests for userId extraction from AppSync events.

Uses hypothesis to verify correctness properties of _get_user_id:
- Returns Cognito sub when identity.sub is present
- Returns "anonymous" when identity is None
- Returns username when identity has no sub but has username
- Returns "anonymous" when identity has neither sub nor username
"""

import sys
import os

# Add parent directory to path so we can import agent_config_handlers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Patch environment variable before importing the module
os.environ.setdefault("AGENT_CONFIGURATIONS_TABLE", "test-table")

# Mock boto3 before importing agent_config_handlers to avoid AWS calls
from unittest.mock import patch, MagicMock

with patch("boto3.resource") as mock_resource:
    mock_resource.return_value.Table.return_value = MagicMock()
    from agent_config_handlers import _get_user_id

from hypothesis import given, settings
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Strategies for generating AppSync events
# ---------------------------------------------------------------------------

# Strategy for non-empty strings representing Cognito sub values
non_empty_sub_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P")),
    min_size=1,
    max_size=64,
)

# Strategy for non-empty username strings
non_empty_username_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P")),
    min_size=1,
    max_size=64,
)


# ---------------------------------------------------------------------------
# Property 1: User ID Extraction
# Validates: Requirements 1.4, 1.6, 1.7
# ---------------------------------------------------------------------------


@given(sub=non_empty_sub_strategy)
@settings(max_examples=100)
def test_property_1_returns_cognito_sub_when_identity_sub_present(sub):
    """**Validates: Requirements 1.4, 1.6, 1.7**

    For any AppSync event where identity.sub is a non-empty string,
    _get_user_id SHALL return the sub value.
    """
    event = {"identity": {"sub": sub}}
    result = _get_user_id(event)

    assert result == sub, (
        f"Expected _get_user_id to return sub '{sub}', got '{result}'"
    )


@settings(max_examples=100)
@given(data=st.data())
def test_property_1_returns_anonymous_when_identity_is_none(data):
    """**Validates: Requirements 1.4, 1.6, 1.7**

    For any AppSync event where identity is None,
    _get_user_id SHALL return "anonymous".
    """
    event = {"identity": None}
    result = _get_user_id(event)

    assert result == "anonymous", (
        f"Expected 'anonymous' when identity is None, got '{result}'"
    )


def test_property_1_returns_anonymous_when_identity_key_missing():
    """**Validates: Requirements 1.4, 1.6, 1.7**

    For any AppSync event where the 'identity' key is absent,
    _get_user_id SHALL return "anonymous".
    """
    event = {}
    result = _get_user_id(event)

    assert result == "anonymous", (
        f"Expected 'anonymous' when identity key is missing, got '{result}'"
    )


@given(username=non_empty_username_strategy)
@settings(max_examples=100)
def test_property_1_returns_username_when_sub_empty_but_username_present(username):
    """**Validates: Requirements 1.4, 1.6, 1.7**

    For any AppSync event where identity.sub is empty but identity.username
    is a non-empty string, _get_user_id SHALL return the username value.
    """
    event = {"identity": {"sub": "", "username": username}}
    result = _get_user_id(event)

    assert result == username, (
        f"Expected _get_user_id to return username '{username}', got '{result}'"
    )


@settings(max_examples=100)
@given(data=st.data())
def test_property_1_returns_anonymous_when_no_sub_no_username(data):
    """**Validates: Requirements 1.4, 1.6, 1.7**

    For any AppSync event where identity has neither sub nor username,
    _get_user_id SHALL return "anonymous".
    """
    event = {"identity": {}}
    result = _get_user_id(event)

    assert result == "anonymous", (
        f"Expected 'anonymous' when identity has no sub and no username, got '{result}'"
    )
