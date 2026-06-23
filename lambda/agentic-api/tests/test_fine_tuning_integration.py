"""Integration tests for the full registration → deploy → delete lifecycle.

Tests the complete handler flow from arguments to response, mocking AWS service
calls (SageMaker, Bedrock) but testing the full handler logic including DynamoDB
interactions (also mocked).

Requirements: 3.1, 4.1, 5.1, 7.1, 7.2
"""

import os
import sys
import uuid

import pytest
from unittest.mock import patch, MagicMock, call

# Add parent directory to path so we can import fine_tuning_handlers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Patch environment variables before importing the module
os.environ.setdefault("AGENT_CONFIGURATIONS_TABLE", "test-table")
os.environ.setdefault("TRAINING_ARTIFACTS_BUCKET", "test-bucket")


@pytest.fixture(autouse=True)
def env_vars(monkeypatch):
    """Set required environment variables for module import."""
    monkeypatch.setenv("AGENT_CONFIGURATIONS_TABLE", "test-table")
    monkeypatch.setenv("TRAINING_ARTIFACTS_BUCKET", "test-bucket")


@pytest.fixture
def handlers():
    """Import handlers after setting env vars."""
    import importlib
    import fine_tuning_handlers

    importlib.reload(fine_tuning_handlers)
    return fine_tuning_handlers


@pytest.fixture
def mock_event():
    """Standard AppSync event with Cognito identity."""
    return {"identity": {"sub": "user-abc-123"}}


@pytest.fixture
def valid_arn():
    """Valid SageMaker training job ARN for testing."""
    return "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-fine-tuned-model"


class TestFullRegistrationFlow:
    """Test RegisterCustomModel with valid ARN → verify DynamoDB record created.

    Requirements: 3.1
    """

    def test_register_valid_arn_returns_registered_status_with_uuid(
        self, handlers, mock_event, valid_arn
    ):
        """Valid ARN + name → returns status 'Registered' with a valid modelId UUID."""
        arguments = {"name": "My Custom Model", "trainingJobArn": valid_arn}

        mock_sagemaker_response = {
            "TrainingJobStatus": "Completed",
            "AlgorithmSpecification": {"TrainingImage": "base-model-v1"},
        }

        with patch.object(
            handlers.sagemaker_client,
            "describe_training_job",
            return_value=mock_sagemaker_response,
        ), patch.object(
            handlers.agent_configurations_table,
            "query",
            return_value={"Items": []},
        ), patch.object(
            handlers.agent_configurations_table,
            "put_item",
            return_value={},
        ) as mock_put:
            result = handlers.handle_register_custom_model(arguments, mock_event)

        # Verify response
        assert result["status"] == "Registered"
        assert result["name"] == "My Custom Model"
        assert result["trainingJobArn"] == valid_arn
        assert result["userId"] == "user-abc-123"
        assert result["failureReason"] is None
        assert result["baseModelId"] == "base-model-v1"
        assert result["createdAt"] is not None
        assert result["updatedAt"] is not None

        # Verify modelId is a valid UUID
        model_id = result["modelId"]
        assert model_id != ""
        uuid.UUID(model_id)  # Raises ValueError if not valid UUID

        # Verify DynamoDB put_item was called with correct record
        mock_put.assert_called_once()
        put_item_arg = mock_put.call_args[1]["Item"] if mock_put.call_args[1] else mock_put.call_args[0][0]
        # Check via kwargs
        if "Item" in (mock_put.call_args.kwargs or {}):
            put_item_arg = mock_put.call_args.kwargs["Item"]
        else:
            put_item_arg = mock_put.call_args[1]["Item"]
        assert put_item_arg["userId"] == "user-abc-123"
        assert put_item_arg["sk"] == f"CUSTOMMODEL#{model_id}"
        assert put_item_arg["status"] == "Registered"
        assert put_item_arg["trainingJobArn"] == valid_arn


class TestDeployFlow:
    """Test DeployCustomModel → verify status transitions.

    Requirements: 4.1
    """

    def test_deploy_registered_model_returns_deployed_with_deployment_arn(
        self, handlers, mock_event
    ):
        """Registered model + deploy → returns status 'Deployed' with deploymentArn."""
        model_id = str(uuid.uuid4())
        arguments = {"modelId": model_id}

        existing_item = {
            "userId": "user-abc-123",
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": "My Model",
            "trainingJobArn": "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job",
            "status": "Registered",
            "baseModelId": "base-model-v1",
            "deploymentArn": None,
            "failureReason": None,
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-01T00:00:00+00:00",
        }

        deployment_arn = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-123"
        mock_deploy_response = {"customModelDeploymentArn": deployment_arn}

        with patch.object(
            handlers.agent_configurations_table,
            "get_item",
            return_value={"Item": existing_item},
        ), patch.object(
            handlers.agent_configurations_table,
            "update_item",
            return_value={},
        ), patch.object(
            handlers.bedrock_client,
            "create_custom_model_deployment",
            return_value=mock_deploy_response,
        ):
            result = handlers.handle_deploy_custom_model(arguments, mock_event)

        assert result["status"] == "Deployed"
        assert result["deploymentArn"] == deployment_arn
        assert result["modelId"] == model_id
        assert result["failureReason"] is None

    def test_deploy_failure_returns_failed_with_failure_reason(
        self, handlers, mock_event
    ):
        """Registered model + Bedrock error → returns status 'Failed' with failureReason."""
        model_id = str(uuid.uuid4())
        arguments = {"modelId": model_id}

        existing_item = {
            "userId": "user-abc-123",
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": "My Model",
            "trainingJobArn": "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job",
            "status": "Registered",
            "baseModelId": "base-model-v1",
            "deploymentArn": None,
            "failureReason": None,
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-01T00:00:00+00:00",
        }

        bedrock_error = Exception("ServiceQuotaExceededException: Deployment limit reached")

        with patch.object(
            handlers.agent_configurations_table,
            "get_item",
            return_value={"Item": existing_item},
        ), patch.object(
            handlers.agent_configurations_table,
            "update_item",
            return_value={},
        ), patch.object(
            handlers.bedrock_client,
            "create_custom_model_deployment",
            side_effect=bedrock_error,
        ):
            result = handlers.handle_deploy_custom_model(arguments, mock_event)

        assert result["status"] == "Failed"
        assert "ServiceQuotaExceededException" in result["failureReason"]
        assert result["modelId"] == model_id


class TestDeleteFlow:
    """Test DeleteCustomModel → verify cleanup.

    Requirements: 5.1
    """

    def test_delete_deployed_model_calls_bedrock_delete_and_dynamo_delete(
        self, handlers, mock_event
    ):
        """Deployed model + delete → calls Bedrock delete + DynamoDB delete."""
        model_id = str(uuid.uuid4())
        deployment_arn = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-123"
        arguments = {"modelId": model_id, "force": True}

        existing_item = {
            "userId": "user-abc-123",
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": "My Model",
            "trainingJobArn": "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job",
            "status": "Deployed",
            "deploymentArn": deployment_arn,
        }

        mock_bedrock_delete = MagicMock(return_value={})
        mock_dynamo_delete = MagicMock(return_value={})

        with patch.object(
            handlers.agent_configurations_table,
            "get_item",
            return_value={"Item": existing_item},
        ), patch.object(
            handlers.bedrock_client,
            "delete_custom_model_deployment",
            mock_bedrock_delete,
        ), patch.object(
            handlers.agent_configurations_table,
            "delete_item",
            mock_dynamo_delete,
        ):
            result = handlers.handle_delete_custom_model(arguments, mock_event)

        assert result["success"] is True
        assert result["statusCode"] == 200

        # Verify Bedrock delete was called with the deployment ARN
        mock_bedrock_delete.assert_called_once_with(
            customModelDeploymentIdentifier=deployment_arn
        )

        # Verify DynamoDB delete was called
        mock_dynamo_delete.assert_called_once_with(
            Key={"userId": "user-abc-123", "sk": f"CUSTOMMODEL#{model_id}"}
        )

    def test_delete_with_usage_warning_returns_409(self, handlers, mock_event):
        """Model in use + delete without force → returns 409 with usage info."""
        model_id = str(uuid.uuid4())
        deployment_arn = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-123"
        arguments = {"modelId": model_id, "force": False}

        existing_item = {
            "userId": "user-abc-123",
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": "My Model",
            "trainingJobArn": "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job",
            "status": "Deployed",
            "deploymentArn": deployment_arn,
        }

        # Supervisor uses this deployment ARN as its modelId
        supervisor_item = {
            "userId": "user-abc-123",
            "sk": "SUPERVISOR",
            "name": "Main Supervisor",
            "modelId": deployment_arn,
        }

        # Sub-agents also use it
        subagent_items = [
            {
                "userId": "user-abc-123",
                "sk": "SUBAGENT#sub1",
                "name": "Research Agent",
                "modelId": deployment_arn,
            }
        ]

        def mock_get_item(Key):
            if Key["sk"] == f"CUSTOMMODEL#{model_id}":
                return {"Item": existing_item}
            elif Key["sk"] == "SUPERVISOR":
                return {"Item": supervisor_item}
            return {"Item": None}

        with patch.object(
            handlers.agent_configurations_table,
            "get_item",
            side_effect=mock_get_item,
        ), patch.object(
            handlers.agent_configurations_table,
            "query",
            return_value={"Items": subagent_items},
        ):
            result = handlers.handle_delete_custom_model(arguments, mock_event)

        assert result["success"] is False
        assert result["statusCode"] == 409
        assert "in use" in result["message"].lower() or "Model is currently in use" in result["message"]

    def test_force_delete_model_in_use_deletes_anyway(self, handlers, mock_event):
        """Model in use + force=true → deletes anyway."""
        model_id = str(uuid.uuid4())
        deployment_arn = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-123"
        arguments = {"modelId": model_id, "force": True}

        existing_item = {
            "userId": "user-abc-123",
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": "My Model",
            "trainingJobArn": "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job",
            "status": "Deployed",
            "deploymentArn": deployment_arn,
        }

        mock_bedrock_delete = MagicMock(return_value={})
        mock_dynamo_delete = MagicMock(return_value={})

        with patch.object(
            handlers.agent_configurations_table,
            "get_item",
            return_value={"Item": existing_item},
        ), patch.object(
            handlers.bedrock_client,
            "delete_custom_model_deployment",
            mock_bedrock_delete,
        ), patch.object(
            handlers.agent_configurations_table,
            "delete_item",
            mock_dynamo_delete,
        ):
            result = handlers.handle_delete_custom_model(arguments, mock_event)

        # Force delete succeeds regardless of usage
        assert result["success"] is True
        assert result["statusCode"] == 200
        mock_bedrock_delete.assert_called_once()
        mock_dynamo_delete.assert_called_once()


class TestResetFlow:
    """Test reset flow → verify all models cleaned up.

    Requirements: 7.1, 7.2
    """

    def test_reset_deletes_all_deployments_and_records(self, handlers):
        """Multiple models → all deployments and records deleted."""
        user_id = "user-abc-123"

        deployment_arn_1 = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-1"
        deployment_arn_2 = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-2"

        model_items = [
            {
                "userId": user_id,
                "sk": "CUSTOMMODEL#model-1",
                "modelId": "model-1",
                "name": "Model 1",
                "status": "Deployed",
                "deploymentArn": deployment_arn_1,
            },
            {
                "userId": user_id,
                "sk": "CUSTOMMODEL#model-2",
                "modelId": "model-2",
                "name": "Model 2",
                "status": "Deployed",
                "deploymentArn": deployment_arn_2,
            },
            {
                "userId": user_id,
                "sk": "CUSTOMMODEL#model-3",
                "modelId": "model-3",
                "name": "Model 3 (no deployment)",
                "status": "Registered",
                "deploymentArn": None,
            },
        ]

        mock_bedrock_delete = MagicMock(return_value={})
        mock_dynamo_delete = MagicMock(return_value={})

        with patch.object(
            handlers.agent_configurations_table,
            "query",
            return_value={"Items": model_items},
        ), patch.object(
            handlers.bedrock_client,
            "delete_custom_model_deployment",
            mock_bedrock_delete,
        ), patch.object(
            handlers.agent_configurations_table,
            "delete_item",
            mock_dynamo_delete,
        ):
            handlers.handle_reset_custom_models(user_id)

        # Verify Bedrock delete was called for both deployed models (not for the Registered one)
        assert mock_bedrock_delete.call_count == 2
        mock_bedrock_delete.assert_any_call(
            customModelDeploymentIdentifier=deployment_arn_1
        )
        mock_bedrock_delete.assert_any_call(
            customModelDeploymentIdentifier=deployment_arn_2
        )

        # Verify DynamoDB delete was called for ALL 3 models
        assert mock_dynamo_delete.call_count == 3
        mock_dynamo_delete.assert_any_call(
            Key={"userId": user_id, "sk": "CUSTOMMODEL#model-1"}
        )
        mock_dynamo_delete.assert_any_call(
            Key={"userId": user_id, "sk": "CUSTOMMODEL#model-2"}
        )
        mock_dynamo_delete.assert_any_call(
            Key={"userId": user_id, "sk": "CUSTOMMODEL#model-3"}
        )

    def test_reset_continues_on_individual_failures(self, handlers):
        """Reset continues on individual deletion failures (best-effort cleanup)."""
        user_id = "user-abc-123"

        deployment_arn_1 = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-1"
        deployment_arn_2 = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-2"

        model_items = [
            {
                "userId": user_id,
                "sk": "CUSTOMMODEL#model-1",
                "modelId": "model-1",
                "status": "Deployed",
                "deploymentArn": deployment_arn_1,
            },
            {
                "userId": user_id,
                "sk": "CUSTOMMODEL#model-2",
                "modelId": "model-2",
                "status": "Deployed",
                "deploymentArn": deployment_arn_2,
            },
        ]

        # First Bedrock delete fails, second succeeds
        mock_bedrock_delete = MagicMock(
            side_effect=[Exception("Bedrock error for model-1"), None]
        )
        mock_dynamo_delete = MagicMock(return_value={})

        with patch.object(
            handlers.agent_configurations_table,
            "query",
            return_value={"Items": model_items},
        ), patch.object(
            handlers.bedrock_client,
            "delete_custom_model_deployment",
            mock_bedrock_delete,
        ), patch.object(
            handlers.agent_configurations_table,
            "delete_item",
            mock_dynamo_delete,
        ):
            # Should not raise — continues on failure
            handlers.handle_reset_custom_models(user_id)

        # Both Bedrock deletes were attempted
        assert mock_bedrock_delete.call_count == 2

        # Both DynamoDB deletes were still attempted (best-effort continues)
        assert mock_dynamo_delete.call_count == 2


class TestStatusCheckFlow:
    """Test status check flow: Deploying model + Bedrock says active → updates to Deployed.

    Requirements: 4.1
    """

    def test_deploying_model_bedrock_active_updates_to_deployed(
        self, handlers, mock_event
    ):
        """Deploying model + Bedrock says active → updates to Deployed."""
        model_id = str(uuid.uuid4())
        deployment_arn = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-123"
        arguments = {"modelId": model_id}

        existing_item = {
            "userId": "user-abc-123",
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": "My Model",
            "trainingJobArn": "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job",
            "status": "Deploying",
            "baseModelId": "base-model-v1",
            "deploymentArn": deployment_arn,
            "failureReason": None,
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-01T12:00:00+00:00",
        }

        # Bedrock reports deployment is active
        mock_deployment_response = {"status": "ACTIVE"}

        mock_update_item = MagicMock(return_value={})

        with patch.object(
            handlers.agent_configurations_table,
            "get_item",
            return_value={"Item": existing_item},
        ), patch.object(
            handlers.bedrock_client,
            "get_custom_model_deployment",
            return_value=mock_deployment_response,
        ), patch.object(
            handlers.agent_configurations_table,
            "update_item",
            mock_update_item,
        ):
            result = handlers.handle_get_custom_model_status(arguments, mock_event)

        # Status should be updated to Deployed
        assert result["status"] == "Deployed"
        assert result["modelId"] == model_id

        # Verify DynamoDB update was called to set status to Deployed
        mock_update_item.assert_called_once()
        update_call_kwargs = mock_update_item.call_args[1]
        assert update_call_kwargs["ExpressionAttributeValues"][":status"] == "Deployed"

    def test_deploying_model_bedrock_failed_updates_to_failed(
        self, handlers, mock_event
    ):
        """Deploying model + Bedrock says failed → updates to Failed with reason."""
        model_id = str(uuid.uuid4())
        deployment_arn = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-456"
        arguments = {"modelId": model_id}

        existing_item = {
            "userId": "user-abc-123",
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": "My Model",
            "trainingJobArn": "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job",
            "status": "Deploying",
            "baseModelId": "base-model-v1",
            "deploymentArn": deployment_arn,
            "failureReason": None,
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-01T12:00:00+00:00",
        }

        # Bedrock reports deployment failed
        mock_deployment_response = {
            "status": "FAILED",
            "failureMessage": "Insufficient capacity in region",
        }

        mock_update_item = MagicMock(return_value={})

        with patch.object(
            handlers.agent_configurations_table,
            "get_item",
            return_value={"Item": existing_item},
        ), patch.object(
            handlers.bedrock_client,
            "get_custom_model_deployment",
            return_value=mock_deployment_response,
        ), patch.object(
            handlers.agent_configurations_table,
            "update_item",
            mock_update_item,
        ):
            result = handlers.handle_get_custom_model_status(arguments, mock_event)

        # Status should be updated to Failed
        assert result["status"] == "Failed"
        assert result["failureReason"] == "Insufficient capacity in region"

    def test_deploying_model_bedrock_still_creating_stays_deploying(
        self, handlers, mock_event
    ):
        """Deploying model + Bedrock says still creating → stays Deploying."""
        model_id = str(uuid.uuid4())
        deployment_arn = "arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/deploy-789"
        arguments = {"modelId": model_id}

        existing_item = {
            "userId": "user-abc-123",
            "sk": f"CUSTOMMODEL#{model_id}",
            "modelId": model_id,
            "name": "My Model",
            "trainingJobArn": "arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job",
            "status": "Deploying",
            "baseModelId": "base-model-v1",
            "deploymentArn": deployment_arn,
            "failureReason": None,
            "createdAt": "2024-01-01T00:00:00+00:00",
            "updatedAt": "2024-01-01T12:00:00+00:00",
        }

        # Bedrock reports deployment still in progress
        mock_deployment_response = {"status": "CREATING"}

        with patch.object(
            handlers.agent_configurations_table,
            "get_item",
            return_value={"Item": existing_item},
        ), patch.object(
            handlers.bedrock_client,
            "get_custom_model_deployment",
            return_value=mock_deployment_response,
        ):
            result = handlers.handle_get_custom_model_status(arguments, mock_event)

        # Status should remain Deploying
        assert result["status"] == "Deploying"
