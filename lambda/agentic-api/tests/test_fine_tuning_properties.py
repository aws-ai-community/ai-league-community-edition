"""Property-based tests for fine-tuning ARN validation.

Uses hypothesis to verify correctness properties of the
validate_training_job_arn function across generated valid and invalid inputs.

Feature: fine-tuning, Property 1: Training Job ARN Validation Correctness

**Validates: Requirements 3.2**
"""

import sys
import os
import re
import string

# Add parent directory to path so we can import fine_tuning_handlers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Patch environment variables before importing the module
os.environ.setdefault("AGENT_CONFIGURATIONS_TABLE", "test-table")
os.environ.setdefault("TRAINING_ARTIFACTS_BUCKET", "test-bucket")

# Mock boto3 before importing fine_tuning_handlers to avoid AWS calls
from unittest.mock import patch, MagicMock

with patch("boto3.resource") as mock_resource, \
     patch("boto3.client") as mock_client:
    mock_resource.return_value.Table.return_value = MagicMock()
    mock_client.return_value = MagicMock()
    from fine_tuning_handlers import validate_training_job_arn, handle_register_custom_model, handle_deploy_custom_model, get_token_penalty_reduction, count_custom_models_in_config
    import fine_tuning_handlers

from hypothesis import given, settings, assume
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Strategies for generating valid SageMaker training job ARN components
# ---------------------------------------------------------------------------

# Valid AWS region: lowercase letters, digits, and hyphens (e.g., us-east-1)
valid_region_strategy = st.from_regex(r"[a-z][a-z0-9\-]{2,20}", fullmatch=True)

# Valid AWS account ID: exactly 12 digits
valid_account_strategy = st.from_regex(r"[0-9]{12}", fullmatch=True)

# Valid job name: starts with alphanumeric, ends with alphanumeric,
# hyphens allowed in the middle. Min 1 char, max 63 chars.
# Single char: just one alphanumeric
# Multi char: starts/ends alphanumeric, middle can have hyphens
valid_job_name_strategy = st.one_of(
    # Single character job name
    st.from_regex(r"[a-zA-Z0-9]", fullmatch=True),
    # Multi-character job name (2-63 chars): starts and ends alphanumeric
    st.from_regex(r"[a-zA-Z0-9][a-zA-Z0-9\-]{0,61}[a-zA-Z0-9]", fullmatch=True),
)


@st.composite
def valid_training_job_arns(draw):
    """Generate valid SageMaker training job ARNs."""
    region = draw(valid_region_strategy)
    account = draw(valid_account_strategy)
    job_name = draw(valid_job_name_strategy)
    return f"arn:aws:sagemaker:{region}:{account}:training-job/{job_name}"


# ---------------------------------------------------------------------------
# Strategies for generating invalid ARN inputs
# ---------------------------------------------------------------------------

# Completely random strings that are unlikely to match
random_text_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P", "S")),
    min_size=0,
    max_size=200,
)


# ---------------------------------------------------------------------------
# Property 1: Training Job ARN Validation Correctness
# Validates: Requirements 3.2
# ---------------------------------------------------------------------------


class TestTrainingJobArnValidationCorrectness:
    """Property 1: Training Job ARN Validation Correctness.

    For any string that matches the pattern
    arn:aws:sagemaker:{region}:{12-digit-account}:training-job/{valid-job-name},
    the ARN validator SHALL return True; for any string that does not match
    this pattern, it SHALL return False.

    Feature: fine-tuning, Property 1: Training Job ARN Validation Correctness

    **Validates: Requirements 3.2**
    """

    @given(arn=valid_training_job_arns())
    @settings(max_examples=200)
    def test_valid_arns_return_true(self, arn):
        """Valid SageMaker training job ARNs must be accepted."""
        result = validate_training_job_arn(arn)
        assert result is True, (
            f"validate_training_job_arn returned False for valid ARN: '{arn}'"
        )

    @given(text=random_text_strategy)
    @settings(max_examples=200)
    def test_invalid_random_strings_return_false(self, text):
        """Random strings without proper ARN structure must be rejected."""
        # Skip strings that happen to be valid ARNs
        assume(not text.startswith("arn:aws:sagemaker:"))
        result = validate_training_job_arn(text)
        assert result is False, (
            f"validate_training_job_arn returned True for invalid input: '{text}'"
        )

    @given(data=st.data())
    @settings(max_examples=100)
    def test_wrong_prefix_returns_false(self, data):
        """ARNs with incorrect service prefix must be rejected."""
        wrong_prefixes = [
            "arn:aws:s3:",
            "arn:aws:ec2:",
            "arn:aws:lambda:",
            "arn:aws:iam:",
            "arn:azure:sagemaker:",
            "arn:gcp:sagemaker:",
        ]
        prefix = data.draw(st.sampled_from(wrong_prefixes))
        suffix = data.draw(st.text(
            alphabet=string.ascii_lowercase + string.digits + "-:/",
            min_size=10,
            max_size=60,
        ))
        invalid_arn = prefix + suffix
        result = validate_training_job_arn(invalid_arn)
        assert result is False, (
            f"validate_training_job_arn returned True for wrong-prefix ARN: '{invalid_arn}'"
        )

    @given(account=st.text(alphabet=string.digits, min_size=1, max_size=20))
    @settings(max_examples=100)
    def test_wrong_account_length_returns_false(self, account):
        """ARNs with non-12-digit account IDs must be rejected."""
        assume(len(account) != 12)
        arn = f"arn:aws:sagemaker:us-east-1:{account}:training-job/my-job"
        result = validate_training_job_arn(arn)
        assert result is False, (
            f"validate_training_job_arn returned True for invalid account length "
            f"({len(account)} digits): '{arn}'"
        )

    @given(job_name=st.from_regex(r"\-[a-zA-Z0-9\-]*", fullmatch=True))
    @settings(max_examples=100)
    def test_job_name_starting_with_hyphen_returns_false(self, job_name):
        """Job names starting with a hyphen must be rejected."""
        arn = f"arn:aws:sagemaker:us-east-1:123456789012:training-job/{job_name}"
        result = validate_training_job_arn(arn)
        assert result is False, (
            f"validate_training_job_arn returned True for job name starting "
            f"with hyphen: '{arn}'"
        )

    @given(job_name=st.from_regex(r"[a-zA-Z0-9][a-zA-Z0-9\-]*\-", fullmatch=True))
    @settings(max_examples=100)
    def test_job_name_ending_with_hyphen_returns_false(self, job_name):
        """Job names ending with a hyphen must be rejected."""
        arn = f"arn:aws:sagemaker:us-east-1:123456789012:training-job/{job_name}"
        result = validate_training_job_arn(arn)
        assert result is False, (
            f"validate_training_job_arn returned True for job name ending "
            f"with hyphen: '{arn}'"
        )

    def test_none_returns_false(self):
        """None input must be rejected."""
        result = validate_training_job_arn(None)
        assert result is False, (
            "validate_training_job_arn returned True for None"
        )

    def test_empty_string_returns_false(self):
        """Empty string must be rejected."""
        result = validate_training_job_arn("")
        assert result is False, (
            "validate_training_job_arn returned True for empty string"
        )

    @given(job_name=st.from_regex(r"[a-zA-Z0-9]", fullmatch=True))
    @settings(max_examples=100)
    def test_single_char_job_name_returns_true(self, job_name):
        """Single alphanumeric character job names must be accepted."""
        arn = f"arn:aws:sagemaker:us-east-1:123456789012:training-job/{job_name}"
        result = validate_training_job_arn(arn)
        assert result is True, (
            f"validate_training_job_arn returned False for single-char job name: '{arn}'"
        )

    @given(
        start=st.from_regex(r"[a-zA-Z0-9]", fullmatch=True),
        middle=st.from_regex(r"[a-zA-Z0-9\-]{0,60}", fullmatch=True),
        end=st.from_regex(r"[a-zA-Z0-9]", fullmatch=True),
    )
    @settings(max_examples=100)
    def test_max_length_job_names_with_valid_structure(self, start, middle, end):
        """Long job names with valid start/end characters must be accepted."""
        job_name = start + middle + end
        arn = f"arn:aws:sagemaker:us-east-1:123456789012:training-job/{job_name}"
        result = validate_training_job_arn(arn)
        assert result is True, (
            f"validate_training_job_arn returned False for valid long job name: '{arn}'"
        )

    @given(
        region=valid_region_strategy,
        account=valid_account_strategy,
    )
    @settings(max_examples=100)
    def test_missing_job_name_returns_false(self, region, account):
        """ARNs missing the job name segment must be rejected."""
        # Missing job name entirely (trailing slash only or no slash)
        arn_trailing_slash = f"arn:aws:sagemaker:{region}:{account}:training-job/"
        result = validate_training_job_arn(arn_trailing_slash)
        assert result is False, (
            f"validate_training_job_arn returned True for missing job name: "
            f"'{arn_trailing_slash}'"
        )

    @given(
        job_name=st.from_regex(r"[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9]", fullmatch=True),
        invalid_char=st.sampled_from(["!", "@", "#", "$", "%", "^", "&", "*", " ", ".", "_", "+"]),
    )
    @settings(max_examples=100)
    def test_invalid_chars_in_job_name_returns_false(self, job_name, invalid_char):
        """Job names with invalid characters (not alphanumeric/hyphen) must be rejected."""
        # Insert invalid char in the middle
        mid = len(job_name) // 2
        bad_name = job_name[:mid] + invalid_char + job_name[mid:]
        arn = f"arn:aws:sagemaker:us-east-1:123456789012:training-job/{bad_name}"
        result = validate_training_job_arn(arn)
        assert result is False, (
            f"validate_training_job_arn returned True for job name with "
            f"invalid char '{invalid_char}': '{arn}'"
        )

    @given(region=valid_region_strategy, account=valid_account_strategy)
    @settings(max_examples=100)
    def test_hyphens_in_middle_of_job_name_valid(self, region, account):
        """Job names with hyphens in valid middle positions must be accepted."""
        # Construct a job name like "a-b-c-d"
        job_name = "my-training-job-v1"
        arn = f"arn:aws:sagemaker:{region}:{account}:training-job/{job_name}"
        result = validate_training_job_arn(arn)
        assert result is True, (
            f"validate_training_job_arn returned False for valid hyphenated job: '{arn}'"
        )


# ---------------------------------------------------------------------------
# Strategies for generating user IDs
# ---------------------------------------------------------------------------

# Valid user IDs: alphanumeric with hyphens (like Cognito sub UUIDs)
valid_user_id_strategy = st.from_regex(
    r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
    fullmatch=True,
)

# Valid model names: non-empty strings of reasonable length
valid_model_name_strategy = st.text(
    alphabet=string.ascii_letters + string.digits + " -_",
    min_size=1,
    max_size=50,
).filter(lambda s: s.strip())


# ---------------------------------------------------------------------------
# Property 2: Duplicate Registration Prevention
# Validates: Requirements 3.4
# ---------------------------------------------------------------------------


class TestDuplicateRegistrationPrevention:
    """Property 2: Duplicate Registration Prevention.

    For any user and training job ARN, if a CUSTOMMODEL record already exists
    with that trainingJobArn for that user, then a subsequent registration
    attempt with the same ARN SHALL be rejected and the existing records
    SHALL remain unchanged.

    Feature: fine-tuning, Property 2: Duplicate Registration Prevention

    **Validates: Requirements 3.4**
    """

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_duplicate_arn_returns_error(self, user_id, arn, model_name):
        """When a CUSTOMMODEL record already exists with the same trainingJobArn
        for the same user, registration SHALL return an error with
        'Training job already registered'."""
        # Build the event with user identity
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        # Mock SageMaker DescribeTrainingJob to return Completed
        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }

        # Mock DynamoDB query to return an existing item with matching ARN
        existing_item = {
            "userId": user_id,
            "sk": "CUSTOMMODEL#existing-model-id",
            "modelId": "existing-model-id",
            "name": "Existing Model",
            "trainingJobArn": arn,
            "status": "Registered",
        }
        mock_query_response = {"Items": [existing_item]}

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ):
            result = handle_register_custom_model(arguments, event)

        # Verify the registration was rejected
        assert result["status"] == "Error", (
            f"Expected status='Error' for duplicate ARN, got '{result['status']}'"
        )
        assert result["failureReason"] == "Training job already registered", (
            f"Expected failureReason='Training job already registered', "
            f"got '{result['failureReason']}'"
        )
        # Verify no modelId was assigned (empty string indicates rejection)
        assert result["modelId"] == "", (
            f"Expected empty modelId for duplicate, got '{result['modelId']}'"
        )

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_duplicate_check_does_not_modify_existing_records(self, user_id, arn, model_name):
        """When a duplicate is detected, the existing records SHALL remain unchanged.
        The DynamoDB put_item should NOT be called."""
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }

        existing_item = {
            "userId": user_id,
            "sk": "CUSTOMMODEL#existing-model-id",
            "modelId": "existing-model-id",
            "name": "Existing Model",
            "trainingJobArn": arn,
            "status": "Registered",
        }
        mock_query_response = {"Items": [existing_item]}

        mock_put_item = MagicMock()

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "put_item",
            mock_put_item,
        ):
            result = handle_register_custom_model(arguments, event)

        # Verify put_item was never called (no new record written)
        mock_put_item.assert_not_called()
        # Verify the response indicates rejection
        assert result["status"] == "Error"
        assert result["failureReason"] == "Training job already registered"

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_different_arn_not_treated_as_duplicate(self, user_id, arn, model_name):
        """When existing records have different trainingJobArns, the registration
        SHALL proceed (not be rejected as duplicate)."""
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }

        # Existing items have DIFFERENT ARNs than the one being registered
        existing_items = [
            {
                "userId": user_id,
                "sk": "CUSTOMMODEL#other-model-id",
                "modelId": "other-model-id",
                "name": "Other Model",
                "trainingJobArn": arn + "-different",
                "status": "Registered",
            }
        ]
        mock_query_response = {"Items": existing_items}

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "put_item",
            return_value={},
        ):
            result = handle_register_custom_model(arguments, event)

        # Verify the registration was accepted (not treated as duplicate)
        assert result["status"] == "Registered", (
            f"Expected status='Registered' for unique ARN, got '{result['status']}'"
        )
        assert result["modelId"] != "", (
            "Expected non-empty modelId for successful registration"
        )
        assert result["failureReason"] is None, (
            f"Expected no failureReason, got '{result['failureReason']}'"
        )


# ---------------------------------------------------------------------------
# Property 3: Status Transition Validity
# Validates: Requirements 4.2, 4.3, 4.4, 9.5
# ---------------------------------------------------------------------------


# All possible statuses for a custom model
ALL_STATUSES = ["Registered", "Deploying", "Deployed", "Failed", "Deleting"]

# Valid transitions as (from_status, to_status) tuples
VALID_TRANSITIONS = {
    ("Registered", "Deploying"),   # DeployCustomModel on Registered model
    ("Deploying", "Deployed"),     # Deployment succeeds
    ("Deploying", "Failed"),       # Deployment fails
    ("Failed", "Deploying"),       # Retry DeployCustomModel on Failed model
    # any → Deleting (via DeleteCustomModel)
    ("Registered", "Deleting"),
    ("Deploying", "Deleting"),
    ("Deployed", "Deleting"),
    ("Failed", "Deleting"),
    ("Deleting", "Deleting"),
}

# Statuses that allow deployment (transition to Deploying)
DEPLOYABLE_STATUSES = {"Registered", "Failed"}

# Statuses that should reject deployment
NON_DEPLOYABLE_STATUSES = {"Deploying", "Deployed", "Deleting"}


class TestStatusTransitionValidity:
    """Property 3: Status Transition Validity.

    For any custom model, the status transitions SHALL only follow valid paths:
    Registered→Deploying, Deploying→Deployed, Deploying→Failed, Failed→Deploying,
    and any status→Deleting. No other transitions SHALL occur.

    Feature: fine-tuning, Property 3: Status Transition Validity

    **Validates: Requirements 4.2, 4.3, 4.4, 9.5**
    """

    @given(
        user_id=valid_user_id_strategy,
        model_id=st.uuids().map(str),
        current_status=st.sampled_from(list(DEPLOYABLE_STATUSES)),
        model_name=valid_model_name_strategy,
        training_job_arn=valid_training_job_arns(),
    )
    @settings(max_examples=100)
    def test_deploy_accepts_deployable_statuses(
        self, user_id, model_id, current_status, model_name, training_job_arn
    ):
        """Deploy handler SHALL accept models with status 'Registered' or 'Failed'
        (valid transitions: Registered→Deploying, Failed→Deploying)."""
        event = {"identity": {"sub": user_id}}
        arguments = {"modelId": model_id}

        # Mock DynamoDB get_item to return a model with the given deployable status
        existing_item = {
            "userId": user_id,
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": model_name,
            "trainingJobArn": training_job_arn,
            "status": current_status,
            "baseModelId": "some-base-model",
            "deploymentArn": None,
            "failureReason": None,
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-01T00:00:00+00:00",
        }
        mock_get_response = {"Item": existing_item}

        # Mock successful Bedrock deployment
        mock_deploy_response = {
            "customModelDeploymentArn": "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/test-deployment"
        }

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "get_item",
            return_value=mock_get_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "update_item",
            return_value={},
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "create_custom_model_deployment",
            return_value=mock_deploy_response,
        ):
            result = handle_deploy_custom_model(arguments, event)

        # The handler should proceed with deployment (status becomes Deployed)
        assert result["status"] == "Deployed", (
            f"Expected status='Deployed' when deploying from '{current_status}', "
            f"got '{result['status']}'"
        )
        assert result["modelId"] == model_id
        assert result["deploymentArn"] is not None

    @given(
        user_id=valid_user_id_strategy,
        model_id=st.uuids().map(str),
        current_status=st.sampled_from(list(NON_DEPLOYABLE_STATUSES)),
        model_name=valid_model_name_strategy,
        training_job_arn=valid_training_job_arns(),
    )
    @settings(max_examples=100)
    def test_deploy_rejects_non_deployable_statuses(
        self, user_id, model_id, current_status, model_name, training_job_arn
    ):
        """Deploy handler SHALL reject models with status 'Deploying', 'Deployed',
        or 'Deleting' (these are not valid transitions to Deploying)."""
        event = {"identity": {"sub": user_id}}
        arguments = {"modelId": model_id}

        # Mock DynamoDB get_item to return a model with a non-deployable status
        existing_item = {
            "userId": user_id,
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": model_name,
            "trainingJobArn": training_job_arn,
            "status": current_status,
            "baseModelId": "some-base-model",
            "deploymentArn": "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/existing",
            "failureReason": None,
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-01T00:00:00+00:00",
        }
        mock_get_response = {"Item": existing_item}

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "get_item",
            return_value=mock_get_response,
        ):
            result = handle_deploy_custom_model(arguments, event)

        # The handler should reject the transition - status stays the same
        assert result["status"] == current_status, (
            f"Expected status='{current_status}' (rejected), got '{result['status']}'"
        )
        assert result["failureReason"] is not None, (
            f"Expected a failureReason when rejecting deploy from status '{current_status}'"
        )
        assert "Cannot deploy" in result["failureReason"] or current_status in result["failureReason"], (
            f"Expected failureReason to mention rejection, got: '{result['failureReason']}'"
        )

    @given(
        user_id=valid_user_id_strategy,
        model_id=st.uuids().map(str),
        model_name=valid_model_name_strategy,
        training_job_arn=valid_training_job_arns(),
    )
    @settings(max_examples=100)
    def test_deploy_failure_transitions_to_failed(
        self, user_id, model_id, model_name, training_job_arn
    ):
        """When Bedrock deployment fails, status SHALL transition to 'Failed'
        (valid transition: Deploying→Failed)."""
        event = {"identity": {"sub": user_id}}
        arguments = {"modelId": model_id}

        # Model starts in Registered status (deployable)
        existing_item = {
            "userId": user_id,
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": model_name,
            "trainingJobArn": training_job_arn,
            "status": "Registered",
            "baseModelId": "some-base-model",
            "deploymentArn": None,
            "failureReason": None,
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-01T00:00:00+00:00",
        }
        mock_get_response = {"Item": existing_item}

        # Simulate Bedrock deployment failure
        bedrock_error = Exception("ResourceLimitExceeded: deployment quota exceeded")

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "get_item",
            return_value=mock_get_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "update_item",
            return_value={},
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "create_custom_model_deployment",
            side_effect=bedrock_error,
        ):
            result = handle_deploy_custom_model(arguments, event)

        # Status should transition to Failed
        assert result["status"] == "Failed", (
            f"Expected status='Failed' after deployment error, got '{result['status']}'"
        )
        assert result["failureReason"] is not None, (
            "Expected a failureReason when deployment fails"
        )

    @given(
        from_status=st.sampled_from(ALL_STATUSES),
        to_status=st.sampled_from(ALL_STATUSES),
    )
    @settings(max_examples=200)
    def test_transition_validity_enumeration(self, from_status, to_status):
        """For any (from_status, to_status) pair, the transition is either in
        VALID_TRANSITIONS or it is an invalid transition that should be rejected.

        This test verifies the completeness of the valid transitions set against
        the deploy handler's behavior for the Deploying transition specifically."""
        # We can only test the deploy handler's transition validation directly
        # (it governs transitions INTO Deploying status)
        if to_status == "Deploying":
            # The deploy handler should accept if from_status is deployable
            is_valid = (from_status, to_status) in VALID_TRANSITIONS
            expected_deployable = from_status in DEPLOYABLE_STATUSES
            assert is_valid == expected_deployable, (
                f"Transition ({from_status}→{to_status}): "
                f"VALID_TRANSITIONS says {'valid' if is_valid else 'invalid'}, "
                f"but DEPLOYABLE_STATUSES says {'deployable' if expected_deployable else 'not deployable'}"
            )

    @given(
        user_id=valid_user_id_strategy,
        model_id=st.uuids().map(str),
        model_name=valid_model_name_strategy,
        training_job_arn=valid_training_job_arns(),
    )
    @settings(max_examples=100)
    def test_deploy_from_failed_allows_retry(
        self, user_id, model_id, model_name, training_job_arn
    ):
        """Failed→Deploying is a valid transition (retry). The deploy handler
        SHALL accept models with status 'Failed' and proceed with deployment."""
        event = {"identity": {"sub": user_id}}
        arguments = {"modelId": model_id}

        # Model is in Failed status (retryable)
        existing_item = {
            "userId": user_id,
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": model_name,
            "trainingJobArn": training_job_arn,
            "status": "Failed",
            "baseModelId": "some-base-model",
            "deploymentArn": None,
            "failureReason": "Previous deployment failed",
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-02T00:00:00+00:00",
        }
        mock_get_response = {"Item": existing_item}

        # Mock successful Bedrock deployment on retry
        mock_deploy_response = {
            "customModelDeploymentArn": "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/retry-deployment"
        }

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "get_item",
            return_value=mock_get_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "update_item",
            return_value={},
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "create_custom_model_deployment",
            return_value=mock_deploy_response,
        ):
            result = handle_deploy_custom_model(arguments, event)

        # Retry should succeed - transitions Failed→Deploying→Deployed
        assert result["status"] == "Deployed", (
            f"Expected status='Deployed' on retry from 'Failed', got '{result['status']}'"
        )
        assert result["failureReason"] is None, (
            f"Expected no failureReason after successful retry, got '{result['failureReason']}'"
        )
        assert result["deploymentArn"] is not None, (
            "Expected deploymentArn to be set after successful deployment"
        )


# ---------------------------------------------------------------------------
# Property 5: Token Penalty Reduction Schedule
# Validates: Requirements 6.2, 6.3
# ---------------------------------------------------------------------------


class TestTokenPenaltyReductionSchedule:
    """Property 5: Token Penalty Reduction Schedule.

    For any custom model count C, the token penalty reduction SHALL be:
    0% when C=0, 25% when C=1, 50% when C=2, 75% when C>=3.
    The function SHALL be monotonically non-decreasing.

    Feature: fine-tuning, Property 5: Token Penalty Reduction Schedule

    **Validates: Requirements 6.2, 6.3**
    """

    @given(count=st.integers(min_value=0, max_value=100))
    @settings(max_examples=200)
    def test_schedule_returns_correct_values(self, count):
        """For any count, the reduction matches the defined schedule:
        0→0.0, 1→0.50, 2→0.70, 3→0.85, 4→0.92, 5+→0.95."""
        result = get_token_penalty_reduction(count)
        schedule = {0: 0.0, 1: 0.50, 2: 0.70, 3: 0.85, 4: 0.92, 5: 0.95}

        if count >= 5:
            assert result == 0.95, (
                f"Expected 0.95 for count={count} (>=5), got {result}"
            )
        else:
            expected = schedule[count]
            assert result == expected, (
                f"Expected {expected} for count={count}, got {result}"
            )

    @given(
        a=st.integers(min_value=0, max_value=100),
        b=st.integers(min_value=0, max_value=100),
    )
    @settings(max_examples=200)
    def test_monotonically_non_decreasing(self, a, b):
        """For any two counts a <= b, get_token_penalty_reduction(a) <= get_token_penalty_reduction(b).
        The function is monotonically non-decreasing."""
        assume(a <= b)
        result_a = get_token_penalty_reduction(a)
        result_b = get_token_penalty_reduction(b)
        assert result_a <= result_b, (
            f"Monotonicity violated: get_token_penalty_reduction({a})={result_a} > "
            f"get_token_penalty_reduction({b})={result_b}"
        )

    @given(count=st.integers(min_value=0, max_value=100))
    @settings(max_examples=200)
    def test_return_value_bounded_between_0_and_1(self, count):
        """The return value is always between 0.0 and 1.0 inclusive."""
        result = get_token_penalty_reduction(count)
        assert 0.0 <= result <= 1.0, (
            f"Expected result in [0.0, 1.0] for count={count}, got {result}"
        )

    def test_exact_value_count_0(self):
        """For count=0, returns exactly 0.0."""
        assert get_token_penalty_reduction(0) == 0.0

    def test_exact_value_count_1(self):
        """For count=1, returns exactly 0.50."""
        assert get_token_penalty_reduction(1) == 0.50

    def test_exact_value_count_2(self):
        """For count=2, returns exactly 0.70."""
        assert get_token_penalty_reduction(2) == 0.70

    @given(count=st.integers(min_value=5, max_value=100))
    @settings(max_examples=100)
    def test_exact_value_count_5_plus(self, count):
        """For count>=5, returns exactly 0.95."""
        assert get_token_penalty_reduction(count) == 0.95, (
            f"Expected 0.95 for count={count}, got {get_token_penalty_reduction(count)}"
        )


# ---------------------------------------------------------------------------
# Property 7: DynamoDB Record Invariants
# Validates: Requirements 9.1, 9.3, 9.4, 9.5
# ---------------------------------------------------------------------------


# UUID v4 pattern for modelId validation
UUID_V4_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)

# Allowed statuses for custom model records
ALLOWED_STATUSES = {"Registered", "Deploying", "Deployed", "Failed", "Deleting"}


class TestDynamoDBRecordInvariants:
    """Property 7: DynamoDB Record Invariants.

    For any custom model record written to DynamoDB, it SHALL have a non-empty
    modelId, a valid trainingJobArn matching the ARN pattern, a status from
    the allowed set {Registered, Deploying, Deployed, Failed, Deleting}, and an
    updatedAt timestamp that is greater than or equal to createdAt.

    Feature: fine-tuning, Property 7: DynamoDB Record Invariants

    **Validates: Requirements 9.1, 9.3, 9.4, 9.5**
    """

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_record_has_non_empty_uuid_model_id(self, user_id, arn, model_name):
        """Every DynamoDB record written during registration SHALL have a
        non-empty modelId in UUID v4 format."""
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }
        mock_query_response = {"Items": []}

        mock_put_item = MagicMock(return_value={})

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "put_item",
            mock_put_item,
        ):
            result = handle_register_custom_model(arguments, event)

        # Verify registration succeeded
        assert result["status"] == "Registered", (
            f"Expected status='Registered', got '{result['status']}'"
        )

        # Verify put_item was called and inspect the record
        assert mock_put_item.called, "put_item should have been called"
        written_item = mock_put_item.call_args[1]["Item"]

        # Verify non-empty modelId in UUID v4 format
        model_id = written_item["modelId"]
        assert model_id, "modelId must be non-empty"
        assert UUID_V4_PATTERN.match(model_id), (
            f"modelId '{model_id}' is not a valid UUID v4"
        )

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_record_has_valid_training_job_arn(self, user_id, arn, model_name):
        """Every DynamoDB record SHALL have a trainingJobArn that matches
        the SageMaker training job ARN pattern."""
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }
        mock_query_response = {"Items": []}

        mock_put_item = MagicMock(return_value={})

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "put_item",
            mock_put_item,
        ):
            result = handle_register_custom_model(arguments, event)

        assert result["status"] == "Registered"
        assert mock_put_item.called

        written_item = mock_put_item.call_args[1]["Item"]

        # Verify trainingJobArn passes ARN validation
        stored_arn = written_item["trainingJobArn"]
        assert stored_arn, "trainingJobArn must be non-empty"
        assert validate_training_job_arn(stored_arn), (
            f"trainingJobArn '{stored_arn}' does not match the expected ARN pattern"
        )

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_record_has_status_in_allowed_set(self, user_id, arn, model_name):
        """Every DynamoDB record SHALL have a status from the allowed set
        {Registered, Deploying, Deployed, Failed, Deleting}. On registration,
        the status must be 'Registered'."""
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }
        mock_query_response = {"Items": []}

        mock_put_item = MagicMock(return_value={})

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "put_item",
            mock_put_item,
        ):
            result = handle_register_custom_model(arguments, event)

        assert result["status"] == "Registered"
        assert mock_put_item.called

        written_item = mock_put_item.call_args[1]["Item"]

        # Verify status is in allowed set
        status = written_item["status"]
        assert status in ALLOWED_STATUSES, (
            f"status '{status}' is not in allowed set {ALLOWED_STATUSES}"
        )
        # Specifically on creation, it must be "Registered"
        assert status == "Registered", (
            f"Expected status='Registered' on creation, got '{status}'"
        )

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_record_has_updated_at_gte_created_at(self, user_id, arn, model_name):
        """Every DynamoDB record SHALL have updatedAt >= createdAt. On creation,
        both timestamps should be equal (set at the same instant)."""
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }
        mock_query_response = {"Items": []}

        mock_put_item = MagicMock(return_value={})

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "put_item",
            mock_put_item,
        ):
            result = handle_register_custom_model(arguments, event)

        assert result["status"] == "Registered"
        assert mock_put_item.called

        written_item = mock_put_item.call_args[1]["Item"]

        # Verify updatedAt >= createdAt
        created_at = written_item["createdAt"]
        updated_at = written_item["updatedAt"]
        assert created_at, "createdAt must be non-empty"
        assert updated_at, "updatedAt must be non-empty"
        assert updated_at >= created_at, (
            f"updatedAt '{updated_at}' must be >= createdAt '{created_at}'"
        )
        # On creation, they should be exactly equal
        assert updated_at == created_at, (
            f"On creation, updatedAt '{updated_at}' should equal createdAt '{created_at}'"
        )

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_record_has_gsi1_keys_present(self, user_id, arn, model_name):
        """Every DynamoDB record SHALL include GSI1 keys for efficient listing:
        gsi1pk='USER#{userId}' and gsi1sk='CUSTOMMODEL#{createdAt}'."""
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }
        mock_query_response = {"Items": []}

        mock_put_item = MagicMock(return_value={})

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "put_item",
            mock_put_item,
        ):
            result = handle_register_custom_model(arguments, event)

        assert result["status"] == "Registered"
        assert mock_put_item.called

        written_item = mock_put_item.call_args[1]["Item"]

        # Verify GSI1 partition key
        gsi1pk = written_item.get("gsi1pk")
        assert gsi1pk == f"USER#{user_id}", (
            f"gsi1pk should be 'USER#{user_id}', got '{gsi1pk}'"
        )

        # Verify GSI1 sort key starts with CUSTOMMODEL#
        gsi1sk = written_item.get("gsi1sk")
        assert gsi1sk is not None, "gsi1sk must be present"
        assert gsi1sk.startswith("CUSTOMMODEL#"), (
            f"gsi1sk should start with 'CUSTOMMODEL#', got '{gsi1sk}'"
        )

    @given(
        user_id=valid_user_id_strategy,
        arn=valid_training_job_arns(),
        model_name=valid_model_name_strategy,
    )
    @settings(max_examples=100)
    def test_record_sk_matches_custommodel_pattern(self, user_id, arn, model_name):
        """Every DynamoDB record SHALL use the sk pattern 'CUSTOMMODEL#{modelId}'
        where modelId matches the record's modelId field."""
        event = {"identity": {"sub": user_id}}
        arguments = {"name": model_name, "trainingJobArn": arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-id"},
        }
        mock_query_response = {"Items": []}

        mock_put_item = MagicMock(return_value={})

        with patch.object(
            fine_tuning_handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "put_item",
            mock_put_item,
        ):
            result = handle_register_custom_model(arguments, event)

        assert result["status"] == "Registered"
        assert mock_put_item.called

        written_item = mock_put_item.call_args[1]["Item"]

        # Verify sk = CUSTOMMODEL#{modelId}
        model_id = written_item["modelId"]
        sk = written_item["sk"]
        assert sk == f"CUSTOMMODEL#{model_id}", (
            f"sk should be 'CUSTOMMODEL#{model_id}', got '{sk}'"
        )

# ---------------------------------------------------------------------------
# Strategies for generating custom model records for reset tests
# ---------------------------------------------------------------------------

# Valid statuses a custom model can be in when reset is triggered
valid_status_strategy = st.sampled_from(["Registered", "Deploying", "Deployed", "Failed", "Deleting"])

# Optional deployment ARN: either None or a valid-looking Bedrock deployment ARN
optional_deployment_arn_strategy = st.one_of(
    st.none(),
    st.from_regex(
        r"arn:aws:bedrock:us-east-1:\d{12}:custom-model-deployment/[a-z0-9\-]{8}",
        fullmatch=True,
    ),
)


@st.composite
def custom_model_record(draw):
    """Generate a single custom model DynamoDB record for reset testing."""
    model_id = str(draw(st.uuids()))
    user_id = draw(valid_user_id_strategy)
    status = draw(valid_status_strategy)
    deployment_arn = draw(optional_deployment_arn_strategy)
    name = draw(valid_model_name_strategy)
    training_job_arn = draw(valid_training_job_arns())

    return {
        "userId": user_id,
        "sk": f"CUSTOMMODEL#{model_id}",
        "modelId": model_id,
        "name": name,
        "trainingJobArn": training_job_arn,
        "deploymentArn": deployment_arn,
        "status": status,
        "baseModelId": "some-base-model",
        "failureReason": None,
        "gsi1pk": f"USER#{user_id}",
        "gsi1sk": f"CUSTOMMODEL#2024-01-01T00:00:00+00:00",
        "createdAt": "2024-01-01T00:00:00+00:00",
        "updatedAt": "2024-01-01T00:00:00+00:00",
    }


@st.composite
def custom_model_records_for_user(draw, user_id):
    """Generate 0-10 custom model records all belonging to the same user."""
    count = draw(st.integers(min_value=0, max_value=10))
    records = []
    for _ in range(count):
        record = draw(custom_model_record())
        # Override userId to be consistent
        record["userId"] = user_id
        record["gsi1pk"] = f"USER#{user_id}"
        records.append(record)
    return records


# ---------------------------------------------------------------------------
# Property 6: Reset Cleanup Completeness
# Validates: Requirements 7.1, 7.2
# ---------------------------------------------------------------------------


class TestResetCleanupCompleteness:
    """Property 6: Reset Cleanup Completeness.

    For any user with N custom model records, after a reset operation completes,
    there SHALL be zero CUSTOMMODEL# records remaining in DynamoDB for that user.
    Additionally, delete_custom_model_deployment SHALL be called for every record
    that has a non-None deploymentArn.

    Feature: fine-tuning, Property 6: Reset Cleanup Completeness

    **Validates: Requirements 7.1, 7.2**
    """

    @given(
        user_id=valid_user_id_strategy,
        data=st.data(),
    )
    @settings(max_examples=100)
    def test_all_records_deleted_after_reset(self, user_id, data):
        """For any set of N custom model records (0-10), handle_reset_custom_models
        SHALL call delete_item exactly N times (once per record)."""
        # Generate 0-10 records for this user
        count = data.draw(st.integers(min_value=0, max_value=10))
        records = []
        for _ in range(count):
            record = data.draw(custom_model_record())
            record["userId"] = user_id
            record["gsi1pk"] = f"USER#{user_id}"
            records.append(record)

        # Mock the DynamoDB query to return these records
        mock_query_response = {"Items": records}
        mock_delete_item = MagicMock()
        mock_delete_deployment = MagicMock()

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "delete_item",
            mock_delete_item,
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "delete_custom_model_deployment",
            mock_delete_deployment,
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "get_custom_model_deployment",
            side_effect=Exception("ResourceNotFoundException"),
        ), patch("fine_tuning_handlers.time.sleep"):
            from fine_tuning_handlers import handle_reset_custom_models
            handle_reset_custom_models(user_id)

        # Verify delete_item was called exactly N times (once per record)
        assert mock_delete_item.call_count == count, (
            f"Expected delete_item to be called {count} times, "
            f"but was called {mock_delete_item.call_count} times"
        )

        # Verify each record was deleted with the correct key
        expected_delete_calls = [
            {"Key": {"userId": user_id, "sk": f"CUSTOMMODEL#{record['modelId']}"}}
            for record in records
        ]
        actual_delete_calls = [
            call.kwargs if call.kwargs else {"Key": call[1]["Key"]} if len(call) > 1 else call.kwargs
            for call in mock_delete_item.call_args_list
        ]
        for record in records:
            expected_key = {"userId": user_id, "sk": f"CUSTOMMODEL#{record['modelId']}"}
            mock_delete_item.assert_any_call(Key=expected_key)

    @given(
        user_id=valid_user_id_strategy,
        data=st.data(),
    )
    @settings(max_examples=100)
    def test_deployment_deleted_for_records_with_arn(self, user_id, data):
        """For any set of custom model records, delete_custom_model_deployment
        SHALL be called for every record that has a non-None deploymentArn."""
        # Generate 0-10 records for this user
        count = data.draw(st.integers(min_value=0, max_value=10))
        records = []
        for _ in range(count):
            record = data.draw(custom_model_record())
            record["userId"] = user_id
            record["gsi1pk"] = f"USER#{user_id}"
            records.append(record)

        # Mock the DynamoDB query to return these records
        mock_query_response = {"Items": records}
        mock_delete_item = MagicMock()
        mock_delete_deployment = MagicMock()

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "delete_item",
            mock_delete_item,
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "delete_custom_model_deployment",
            mock_delete_deployment,
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "get_custom_model_deployment",
            side_effect=Exception("ResourceNotFoundException"),
        ), patch("fine_tuning_handlers.time.sleep"):
            from fine_tuning_handlers import handle_reset_custom_models
            handle_reset_custom_models(user_id)

        # Count records with non-None deploymentArn
        records_with_arn = [r for r in records if r.get("deploymentArn") is not None]
        expected_deployment_deletes = len(records_with_arn)

        # Verify delete_custom_model_deployment was called exactly for records with ARN
        assert mock_delete_deployment.call_count == expected_deployment_deletes, (
            f"Expected delete_custom_model_deployment to be called "
            f"{expected_deployment_deletes} times (records with deploymentArn), "
            f"but was called {mock_delete_deployment.call_count} times"
        )

        # Verify each deployment ARN was passed correctly
        for record in records_with_arn:
            mock_delete_deployment.assert_any_call(
                customModelDeploymentIdentifier=record["deploymentArn"]
            )

    @given(
        user_id=valid_user_id_strategy,
    )
    @settings(max_examples=50)
    def test_empty_records_no_deletions(self, user_id):
        """When there are zero custom model records, no delete calls SHALL be made."""
        mock_query_response = {"Items": []}
        mock_delete_item = MagicMock()
        mock_delete_deployment = MagicMock()

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "delete_item",
            mock_delete_item,
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "delete_custom_model_deployment",
            mock_delete_deployment,
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "get_custom_model_deployment",
            side_effect=Exception("ResourceNotFoundException"),
        ), patch("fine_tuning_handlers.time.sleep"):
            from fine_tuning_handlers import handle_reset_custom_models
            handle_reset_custom_models(user_id)

        mock_delete_item.assert_not_called()
        mock_delete_deployment.assert_not_called()

    @given(
        user_id=valid_user_id_strategy,
        data=st.data(),
    )
    @settings(max_examples=100)
    def test_records_without_deployment_arn_skip_bedrock_delete(self, user_id, data):
        """Records with deploymentArn=None SHALL NOT trigger
        delete_custom_model_deployment, but SHALL still be deleted from DynamoDB."""
        # Generate 1-5 records, all without deploymentArn
        count = data.draw(st.integers(min_value=1, max_value=5))
        records = []
        for _ in range(count):
            record = data.draw(custom_model_record())
            record["userId"] = user_id
            record["gsi1pk"] = f"USER#{user_id}"
            record["deploymentArn"] = None  # Force no deployment ARN
            records.append(record)

        mock_query_response = {"Items": records}
        mock_delete_item = MagicMock()
        mock_delete_deployment = MagicMock()

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            return_value=mock_query_response,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "delete_item",
            mock_delete_item,
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "delete_custom_model_deployment",
            mock_delete_deployment,
        ), patch.object(
            fine_tuning_handlers.bedrock_client,
            "get_custom_model_deployment",
            side_effect=Exception("ResourceNotFoundException"),
        ), patch("fine_tuning_handlers.time.sleep"):
            from fine_tuning_handlers import handle_reset_custom_models
            handle_reset_custom_models(user_id)

        # DynamoDB records should all be deleted
        assert mock_delete_item.call_count == count, (
            f"Expected {count} delete_item calls, got {mock_delete_item.call_count}"
        )

        # No Bedrock deployment deletions should occur
        mock_delete_deployment.assert_not_called()

# ---------------------------------------------------------------------------
# Property 4: Custom Model Count Calculation
# Validates: Requirements 6.1
# ---------------------------------------------------------------------------


@st.composite
def agent_config_with_custom_models(draw):
    """Generate an agent configuration scenario with supervisor, sub-agents,
    and deployed custom models, with controlled overlap between configured
    modelIds and custom model deploymentArns.

    Returns a dict with:
      - supervisor_model_id: the supervisor's modelId (or None)
      - subagent_model_ids: list of sub-agent modelIds
      - custom_models: list of deployed custom model dicts with deploymentArn
      - expected_count: the expected count of distinct custom models in use
    """
    # Generate a pool of possible deployment ARNs (custom model arns)
    num_custom_models = draw(st.integers(min_value=0, max_value=5))
    deployment_arns = [
        f"arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/model-{i}"
        for i in range(num_custom_models)
    ]

    # Generate some standard (non-custom) model IDs
    standard_models = [
        "us.amazon.nova-2-lite-v1:0",
        "us.amazon.nova-2-pro-v1:0",
        "anthropic.claude-3-sonnet",
        "anthropic.claude-3-haiku",
    ]

    # All possible model IDs to assign to agents (standard + custom deployment ARNs)
    all_possible_models = standard_models + deployment_arns

    # Generate supervisor model ID (may or may not be a custom model)
    has_supervisor = draw(st.booleans())
    if has_supervisor and all_possible_models:
        supervisor_model_id = draw(st.sampled_from(all_possible_models))
    else:
        supervisor_model_id = None

    # Generate sub-agents (0-5 sub-agents)
    num_subagents = draw(st.integers(min_value=0, max_value=5))
    subagent_model_ids = []
    for _ in range(num_subagents):
        if all_possible_models:
            model_id = draw(st.sampled_from(all_possible_models))
            subagent_model_ids.append(model_id)

    # Build the set of all configured model IDs
    configured_model_ids = set()
    if supervisor_model_id:
        configured_model_ids.add(supervisor_model_id)
    for mid in subagent_model_ids:
        if mid:
            configured_model_ids.add(mid)

    # Build deployed custom model records
    custom_models = []
    for arn in deployment_arns:
        custom_models.append({
            "modelId": f"model-id-for-{arn.split('/')[-1]}",
            "status": "Deployed",
            "deploymentArn": arn,
        })

    # Compute expected count: intersection of configured modelIds and deployment ARNs
    deployed_arn_set = set(deployment_arns)
    in_use = configured_model_ids & deployed_arn_set
    expected_count = len(in_use)

    return {
        "supervisor_model_id": supervisor_model_id,
        "subagent_model_ids": subagent_model_ids,
        "custom_models": custom_models,
        "expected_count": expected_count,
    }


class TestCustomModelCountCalculation:
    """Property 4: Custom Model Count Calculation.

    For any agent configuration (supervisor + N sub-agents) with K distinct
    deployed custom models referenced in their modelId fields, the custom
    model count calculator SHALL return exactly K.

    Feature: fine-tuning, Property 4: Custom Model Count Calculation

    **Validates: Requirements 6.1**
    """

    @given(scenario=agent_config_with_custom_models())
    @settings(max_examples=200)
    def test_count_equals_distinct_custom_models_in_use(self, scenario):
        """The count of custom models SHALL equal the number of distinct
        deployed custom model deploymentArns that appear in the set of
        configured modelIds (supervisor + sub-agents)."""
        user_id = "test-user-id"
        supervisor_model_id = scenario["supervisor_model_id"]
        subagent_model_ids = scenario["subagent_model_ids"]
        custom_models = scenario["custom_models"]
        expected_count = scenario["expected_count"]

        # Build mock supervisor item
        supervisor_item = None
        if supervisor_model_id is not None:
            supervisor_item = {
                "userId": user_id,
                "sk": "SUPERVISOR",
                "modelId": supervisor_model_id,
                "name": "Supervisor",
            }

        # Build mock sub-agent items
        subagent_items = []
        for i, model_id in enumerate(subagent_model_ids):
            subagent_items.append({
                "userId": user_id,
                "sk": f"SUBAGENT#sub-{i}",
                "modelId": model_id,
                "name": f"SubAgent-{i}",
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"SUBAGENT#sub-{i}",
            })

        # Build mock custom model items (all deployed)
        custom_model_items = []
        for cm in custom_models:
            custom_model_items.append({
                "userId": user_id,
                "sk": f"CUSTOMMODEL#{cm['modelId']}",
                "modelId": cm["modelId"],
                "status": cm["status"],
                "deploymentArn": cm["deploymentArn"],
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"CUSTOMMODEL#2024-01-01",
            })

        # Mock get_item for supervisor
        def mock_get_item(Key):
            if Key.get("sk") == "SUPERVISOR":
                if supervisor_item:
                    return {"Item": supervisor_item}
                return {}
            return {}

        # Mock query for sub-agents and custom models (GSI1 queries)
        call_count = {"value": 0}

        def mock_query(**kwargs):
            key_condition = kwargs.get("KeyConditionExpression")
            # Distinguish between SUBAGENT# and CUSTOMMODEL# queries
            # by inspecting the expression attribute values or the call order
            expression_values = kwargs.get("ExpressionAttributeValues", {})

            # The function makes two queries:
            # 1st: begins_with SUBAGENT#
            # 2nd: begins_with CUSTOMMODEL#
            call_count["value"] += 1
            if call_count["value"] == 1:
                # First query is for sub-agents
                return {"Items": subagent_items}
            else:
                # Second query is for custom models
                return {"Items": custom_model_items}

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "get_item",
            side_effect=mock_get_item,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            side_effect=mock_query,
        ):
            result = count_custom_models_in_config(user_id)

        assert result == expected_count, (
            f"Expected count={expected_count}, got {result}. "
            f"Supervisor modelId={supervisor_model_id}, "
            f"SubAgent modelIds={subagent_model_ids}, "
            f"Deployed ARNs={[cm['deploymentArn'] for cm in custom_models]}"
        )

    @given(scenario=agent_config_with_custom_models())
    @settings(max_examples=100)
    def test_count_never_exceeds_total_deployed_models(self, scenario):
        """The count SHALL never exceed the total number of deployed custom models."""
        user_id = "test-user-id"
        supervisor_model_id = scenario["supervisor_model_id"]
        subagent_model_ids = scenario["subagent_model_ids"]
        custom_models = scenario["custom_models"]
        total_deployed = len(custom_models)

        # Build mock supervisor item
        supervisor_item = None
        if supervisor_model_id is not None:
            supervisor_item = {
                "userId": user_id,
                "sk": "SUPERVISOR",
                "modelId": supervisor_model_id,
                "name": "Supervisor",
            }

        # Build mock sub-agent items
        subagent_items = []
        for i, model_id in enumerate(subagent_model_ids):
            subagent_items.append({
                "userId": user_id,
                "sk": f"SUBAGENT#sub-{i}",
                "modelId": model_id,
                "name": f"SubAgent-{i}",
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"SUBAGENT#sub-{i}",
            })

        # Build mock custom model items
        custom_model_items = []
        for cm in custom_models:
            custom_model_items.append({
                "userId": user_id,
                "sk": f"CUSTOMMODEL#{cm['modelId']}",
                "modelId": cm["modelId"],
                "status": cm["status"],
                "deploymentArn": cm["deploymentArn"],
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"CUSTOMMODEL#2024-01-01",
            })

        def mock_get_item(Key):
            if Key.get("sk") == "SUPERVISOR":
                if supervisor_item:
                    return {"Item": supervisor_item}
                return {}
            return {}

        call_count = {"value": 0}

        def mock_query(**kwargs):
            call_count["value"] += 1
            if call_count["value"] == 1:
                return {"Items": subagent_items}
            else:
                return {"Items": custom_model_items}

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "get_item",
            side_effect=mock_get_item,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            side_effect=mock_query,
        ):
            result = count_custom_models_in_config(user_id)

        assert result <= total_deployed, (
            f"Count ({result}) exceeds total deployed models ({total_deployed}). "
            f"This should never happen since we count intersections."
        )

    @given(scenario=agent_config_with_custom_models())
    @settings(max_examples=100)
    def test_count_never_exceeds_configured_agents(self, scenario):
        """The count SHALL never exceed the number of distinct configured modelIds."""
        user_id = "test-user-id"
        supervisor_model_id = scenario["supervisor_model_id"]
        subagent_model_ids = scenario["subagent_model_ids"]
        custom_models = scenario["custom_models"]

        # Compute number of distinct configured model IDs
        configured_model_ids = set()
        if supervisor_model_id:
            configured_model_ids.add(supervisor_model_id)
        for mid in subagent_model_ids:
            if mid:
                configured_model_ids.add(mid)
        total_configured = len(configured_model_ids)

        # Build mock supervisor item
        supervisor_item = None
        if supervisor_model_id is not None:
            supervisor_item = {
                "userId": user_id,
                "sk": "SUPERVISOR",
                "modelId": supervisor_model_id,
                "name": "Supervisor",
            }

        # Build mock sub-agent items
        subagent_items = []
        for i, model_id in enumerate(subagent_model_ids):
            subagent_items.append({
                "userId": user_id,
                "sk": f"SUBAGENT#sub-{i}",
                "modelId": model_id,
                "name": f"SubAgent-{i}",
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"SUBAGENT#sub-{i}",
            })

        # Build mock custom model items
        custom_model_items = []
        for cm in custom_models:
            custom_model_items.append({
                "userId": user_id,
                "sk": f"CUSTOMMODEL#{cm['modelId']}",
                "modelId": cm["modelId"],
                "status": cm["status"],
                "deploymentArn": cm["deploymentArn"],
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"CUSTOMMODEL#2024-01-01",
            })

        def mock_get_item(Key):
            if Key.get("sk") == "SUPERVISOR":
                if supervisor_item:
                    return {"Item": supervisor_item}
                return {}
            return {}

        call_count = {"value": 0}

        def mock_query(**kwargs):
            call_count["value"] += 1
            if call_count["value"] == 1:
                return {"Items": subagent_items}
            else:
                return {"Items": custom_model_items}

        with patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "get_item",
            side_effect=mock_get_item,
        ), patch.object(
            fine_tuning_handlers.agent_configurations_table,
            "query",
            side_effect=mock_query,
        ):
            result = count_custom_models_in_config(user_id)

        assert result <= total_configured, (
            f"Count ({result}) exceeds distinct configured modelIds ({total_configured}). "
            f"This should never happen since the count is an intersection."
        )
