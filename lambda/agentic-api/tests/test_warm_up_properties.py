"""Property-based tests for model warm-up imported model classification.

Uses hypothesis to verify correctness properties of the
is_imported_model function across generated valid and invalid inputs.

Feature: model-warmup, Property 1: Imported Model Classification

**Validates: Requirements 1.2, 1.3**
"""

import sys
import os

# Add parent directory to path so we can import warm_up_handlers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Patch environment variables before importing the module
os.environ.setdefault("AGENT_CONFIGURATIONS_TABLE", "test-table")

# Mock boto3 before importing warm_up_handlers to avoid AWS calls
from unittest.mock import patch, MagicMock

with patch("boto3.resource") as mock_resource:
    mock_resource.return_value.Table.return_value = MagicMock()
    from warm_up_handlers import is_imported_model, _deduplicate_arns

from hypothesis import given, settings, assume
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Property 1: Imported Model Classification
# Validates: Requirements 1.2, 1.3
# ---------------------------------------------------------------------------


class TestImportedModelClassification:
    """Property 1: Imported Model Classification.

    For any model_id string, the classification function shall return True
    if and only if the string contains the substring "imported-model/".
    For any agent configuration containing zero model IDs with this substring,
    the warm-up phase shall be skipped.

    Feature: model-warmup, Property 1: Imported Model Classification

    **Validates: Requirements 1.2, 1.3**
    """

    @given(text=st.text(min_size=0, max_size=300))
    @settings(max_examples=100)
    def test_returns_true_iff_contains_imported_model_substring(self, text):
        """is_imported_model returns True if and only if input contains 'imported-model/'."""
        expected = "imported-model/" in text
        result = is_imported_model(text)
        assert result == expected, (
            f"is_imported_model('{text}') returned {result}, "
            f"expected {expected} (contains 'imported-model/': {expected})"
        )

    @given(
        prefix=st.text(min_size=0, max_size=100),
        suffix=st.text(min_size=0, max_size=100),
    )
    @settings(max_examples=100)
    def test_strings_with_imported_model_substring_return_true(self, prefix, suffix):
        """Any string containing 'imported-model/' must be classified as imported."""
        model_id = prefix + "imported-model/" + suffix
        result = is_imported_model(model_id)
        assert result is True, (
            f"is_imported_model('{model_id}') returned False, "
            f"but it contains 'imported-model/'"
        )

    @given(text=st.text(min_size=0, max_size=300))
    @settings(max_examples=100)
    def test_strings_without_imported_model_substring_return_false(self, text):
        """Any string NOT containing 'imported-model/' must NOT be classified as imported."""
        assume("imported-model/" not in text)
        result = is_imported_model(text)
        assert result is False, (
            f"is_imported_model('{text}') returned True, "
            f"but it does not contain 'imported-model/'"
        )

    @given(
        region=st.from_regex(r"[a-z]{2}-[a-z]+-[0-9]", fullmatch=True),
        account=st.from_regex(r"[0-9]{12}", fullmatch=True),
        model_id=st.from_regex(r"[a-z0-9]{8,20}", fullmatch=True),
    )
    @settings(max_examples=100)
    def test_valid_imported_model_arns_return_true(self, region, account, model_id):
        """Realistic imported model ARNs must be classified as imported."""
        arn = f"arn:aws:bedrock:{region}:{account}:imported-model/{model_id}"
        result = is_imported_model(arn)
        assert result is True, (
            f"is_imported_model('{arn}') returned False for valid imported model ARN"
        )

    @given(
        region=st.from_regex(r"[a-z]{2}-[a-z]+-[0-9]", fullmatch=True),
        account=st.from_regex(r"[0-9]{12}", fullmatch=True),
        model_id=st.from_regex(r"[a-z0-9]{8,20}", fullmatch=True),
    )
    @settings(max_examples=100)
    def test_standard_foundation_model_arns_return_false(self, region, account, model_id):
        """Standard Bedrock foundation model ARNs must NOT be classified as imported."""
        arn = f"arn:aws:bedrock:{region}:{account}:foundation-model/{model_id}"
        result = is_imported_model(arn)
        assert result is False, (
            f"is_imported_model('{arn}') returned True for standard foundation model ARN"
        )

    def test_none_input_returns_false(self):
        """None input must return False (no imported model)."""
        result = is_imported_model(None)
        assert result is False, (
            "is_imported_model(None) returned True, expected False"
        )

    def test_empty_string_returns_false(self):
        """Empty string must return False (no imported model)."""
        result = is_imported_model("")
        assert result is False, (
            "is_imported_model('') returned True, expected False"
        )


# ---------------------------------------------------------------------------
# Property 2: ARN Deduplication Preserves Membership
# Validates: Requirements 1.4
# ---------------------------------------------------------------------------


class TestArnDeduplicationPreservesMembership:
    """Property 2: ARN Deduplication Preserves Membership.

    For any list of model ARN strings (with arbitrary duplicates), the
    deduplicated output shall contain exactly the same set of unique ARNs
    as the input — no ARNs added, no ARNs lost. The output preserves
    insertion order of first occurrence and contains no duplicates.

    Feature: model-warmup, Property 2: ARN Deduplication Preserves Membership

    **Validates: Requirements 1.4**
    """

    @given(arns=st.lists(st.text(min_size=0, max_size=200), min_size=0, max_size=50))
    @settings(max_examples=100)
    def test_output_has_same_unique_set_as_input(self, arns):
        """The deduplicated output must contain the same set of unique elements as the input."""
        result = _deduplicate_arns(arns)
        assert set(result) == set(arns), (
            f"Set mismatch: output set {set(result)} != input set {set(arns)}"
        )

    @given(arns=st.lists(st.text(min_size=0, max_size=200), min_size=0, max_size=50))
    @settings(max_examples=100)
    def test_output_contains_no_duplicates(self, arns):
        """The deduplicated output must contain no duplicate entries."""
        result = _deduplicate_arns(arns)
        assert len(result) == len(set(result)), (
            f"Duplicates found in output: {result} "
            f"(length {len(result)} vs unique count {len(set(result))})"
        )

    @given(arns=st.lists(st.text(min_size=0, max_size=200), min_size=0, max_size=50))
    @settings(max_examples=100)
    def test_output_preserves_first_occurrence_order(self, arns):
        """The deduplicated output must preserve insertion order of first occurrence."""
        result = _deduplicate_arns(arns)
        # Build the expected order manually: iterate input, keep first occurrence
        expected_order = []
        seen = set()
        for arn in arns:
            if arn not in seen:
                seen.add(arn)
                expected_order.append(arn)
        assert result == expected_order, (
            f"Order mismatch: got {result}, expected {expected_order}"
        )

    @given(arns=st.lists(st.text(min_size=0, max_size=200), min_size=0, max_size=50))
    @settings(max_examples=100)
    def test_no_additions_beyond_input(self, arns):
        """The output must not contain any ARN that was not present in the input."""
        result = _deduplicate_arns(arns)
        input_set = set(arns)
        for arn in result:
            assert arn in input_set, (
                f"Output contains '{arn}' which was not in the input"
            )

    @given(arns=st.lists(st.text(min_size=0, max_size=200), min_size=0, max_size=50))
    @settings(max_examples=100)
    def test_no_losses_from_input(self, arns):
        """Every unique ARN in the input must appear in the output."""
        result = _deduplicate_arns(arns)
        result_set = set(result)
        for arn in set(arns):
            assert arn in result_set, (
                f"Input ARN '{arn}' was lost — not present in output"
            )

    @given(
        base_arns=st.lists(st.text(min_size=1, max_size=100), min_size=1, max_size=10, unique=True),
        data=st.data(),
    )
    @settings(max_examples=100)
    def test_duplicated_input_produces_same_result_as_unique_input(self, base_arns, data):
        """Duplicating elements in the input does not change the output set or order."""
        # Create a list with arbitrary duplicates by repeating elements
        duplicated = []
        for arn in base_arns:
            repeat_count = data.draw(st.integers(min_value=1, max_value=5))
            duplicated.extend([arn] * repeat_count)
        # Shuffle to introduce duplicates at arbitrary positions
        shuffled = data.draw(st.permutations(duplicated))

        result = _deduplicate_arns(list(shuffled))

        # The output set must equal the base set
        assert set(result) == set(base_arns), (
            f"Set mismatch after duplication: {set(result)} != {set(base_arns)}"
        )
        # No duplicates in output
        assert len(result) == len(set(result)), (
            f"Duplicates found after deduplication: {result}"
        )


# ---------------------------------------------------------------------------
# Property 3: Warm-Up Status Validity
# Validates: Requirements 3.4
# ---------------------------------------------------------------------------


class TestWarmUpStatusValidity:
    """Property 3: Warm-Up Status Validity.

    For any warm-up session in any state, the overall status returned by the
    WarmUpStatus query shall always be one of the valid enum values: pending,
    warming, ready, timeout, or skipped.

    Feature: model-warmup, Property 3: Warm-Up Status Validity

    **Validates: Requirements 3.4**
    """

    VALID_STATUSES = {"pending", "warming", "ready", "timeout", "skipped"}

    @given(status=st.text(min_size=0, max_size=100))
    @settings(max_examples=100)
    def test_returned_status_is_always_valid_for_arbitrary_stored_status(self, status):
        """For any arbitrary status string stored in DynamoDB, the returned status must be valid."""
        session_id = "test-session-123"
        user_id = "test-user-456"

        # Build a mock DynamoDB item with an arbitrary status
        mock_item = {
            "userId": user_id,
            "sk": f"WARMUP#{session_id}",
            "sessionId": session_id,
            "status": status,
            "models": [],
            "message": None,
        }

        mock_table = MagicMock()
        mock_table.get_item.return_value = {"Item": mock_item}

        with patch("warm_up_handlers.agent_configurations_table", mock_table):
            from warm_up_handlers import handle_warm_up_status

            result = handle_warm_up_status(
                arguments={"sessionId": session_id},
                event={"identity": {"sub": user_id}},
            )

        assert result["status"] in self.VALID_STATUSES, (
            f"Returned status '{result['status']}' is not in valid set "
            f"{self.VALID_STATUSES} when stored status was '{status}'"
        )

    @given(status=st.sampled_from(["pending", "warming", "ready", "timeout", "skipped"]))
    @settings(max_examples=100)
    def test_valid_statuses_are_returned_unchanged(self, status):
        """Valid status values stored in DynamoDB must be returned as-is."""
        session_id = "test-session-valid"
        user_id = "test-user-valid"

        mock_item = {
            "userId": user_id,
            "sk": f"WARMUP#{session_id}",
            "sessionId": session_id,
            "status": status,
            "models": [],
            "message": None,
        }

        mock_table = MagicMock()
        mock_table.get_item.return_value = {"Item": mock_item}

        with patch("warm_up_handlers.agent_configurations_table", mock_table):
            from warm_up_handlers import handle_warm_up_status

            result = handle_warm_up_status(
                arguments={"sessionId": session_id},
                event={"identity": {"sub": user_id}},
            )

        assert result["status"] == status, (
            f"Valid status '{status}' was changed to '{result['status']}'"
        )

    @given(status=st.text(min_size=0, max_size=100).filter(
        lambda s: s not in {"pending", "warming", "ready", "timeout", "skipped"}
    ))
    @settings(max_examples=100)
    def test_invalid_statuses_are_normalized_to_pending(self, status):
        """Invalid status values stored in DynamoDB must be normalized to 'pending'."""
        session_id = "test-session-invalid"
        user_id = "test-user-invalid"

        mock_item = {
            "userId": user_id,
            "sk": f"WARMUP#{session_id}",
            "sessionId": session_id,
            "status": status,
            "models": [],
            "message": None,
        }

        mock_table = MagicMock()
        mock_table.get_item.return_value = {"Item": mock_item}

        with patch("warm_up_handlers.agent_configurations_table", mock_table):
            from warm_up_handlers import handle_warm_up_status

            result = handle_warm_up_status(
                arguments={"sessionId": session_id},
                event={"identity": {"sub": user_id}},
            )

        assert result["status"] == "pending", (
            f"Invalid status '{status}' was not normalized to 'pending', "
            f"got '{result['status']}' instead"
        )

    def test_missing_session_returns_skipped_status(self):
        """When session is not found in DynamoDB, status must be 'skipped'."""
        session_id = "nonexistent-session"
        user_id = "test-user"

        mock_table = MagicMock()
        mock_table.get_item.return_value = {}  # No Item key

        with patch("warm_up_handlers.agent_configurations_table", mock_table):
            from warm_up_handlers import handle_warm_up_status

            result = handle_warm_up_status(
                arguments={"sessionId": session_id},
                event={"identity": {"sub": user_id}},
            )

        assert result["status"] == "skipped", (
            f"Missing session should return 'skipped', got '{result['status']}'"
        )
        assert result["status"] in self.VALID_STATUSES

    def test_missing_status_field_defaults_to_pending(self):
        """When the DynamoDB item has no status field, it must default to 'pending'."""
        session_id = "test-session-no-status"
        user_id = "test-user"

        mock_item = {
            "userId": user_id,
            "sk": f"WARMUP#{session_id}",
            "sessionId": session_id,
            "models": [],
            "message": None,
            # No 'status' field
        }

        mock_table = MagicMock()
        mock_table.get_item.return_value = {"Item": mock_item}

        with patch("warm_up_handlers.agent_configurations_table", mock_table):
            from warm_up_handlers import handle_warm_up_status

            result = handle_warm_up_status(
                arguments={"sessionId": session_id},
                event={"identity": {"sub": user_id}},
            )

        assert result["status"] == "pending", (
            f"Missing status field should default to 'pending', got '{result['status']}'"
        )
        assert result["status"] in self.VALID_STATUSES
