"""Unit tests for config_validator module.

Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 1.4, 1.5
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config_validator import validate_config, ConfigValidationError


# --- Valid configs ---

MINIMAL_VALID_CONFIG = {
    "supervisor": {
        "name": "My Agent",
        "systemPrompt": "You are an orchestrator.",
    },
}

FULL_VALID_CONFIG = {
    "supervisor": {
        "name": "Dungeon Master",
        "systemPrompt": "Orchestrate agents.",
        "modelId": "us.amazon.nova-2-lite-v1:0",
        "subAgents": ["Pathfinding Specialist"],
        "tools": ["Pathfinder"],
        "memory": "GameMemory",
        "guardrail": "SafetyGuard",
    },
    "subAgents": [
        {
            "name": "Pathfinding Specialist",
            "systemPrompt": "Find paths.",
            "modelId": "us.amazon.nova-2-lite-v1:0",
            "tools": ["Pathfinder"],
        }
    ],
    "tools": [
        {"name": "Pathfinder", "sourceDir": "tools/Pathfinder"},
    ],
    "memory": {
        "name": "GameMemory",
        "description": "Stores game history",
    },
    "guardrail": {
        "name": "SafetyGuard",
        "description": "Content safety",
        "blockedInputMessaging": "Blocked.",
        "blockedOutputsMessaging": "Blocked.",
        "contentFilters": [
            {"type": "VIOLENCE", "inputStrength": "MEDIUM", "outputStrength": "MEDIUM"},
            {"type": "HATE", "inputStrength": "HIGH", "outputStrength": "HIGH"},
        ],
        "denyTopics": [
            {
                "name": "Violence",
                "definition": "Real-world violence",
                "inputAction": "BLOCK",
                "outputAction": "BLOCK",
                "examples": ["How to make a weapon"],
            }
        ],
    },
}


class TestValidConfig:
    """Tests that valid configurations pass validation."""

    def test_minimal_config_passes(self):
        warnings = validate_config(MINIMAL_VALID_CONFIG)
        assert isinstance(warnings, list)

    def test_full_config_passes(self):
        warnings = validate_config(FULL_VALID_CONFIG)
        assert isinstance(warnings, list)

    def test_no_tools_no_subagents(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
        }
        warnings = validate_config(config)
        assert isinstance(warnings, list)

    def test_null_memory_and_guardrail(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "memory": None,
            "guardrail": None,
        }
        warnings = validate_config(config)
        assert isinstance(warnings, list)


class TestMissingRequiredFields:
    """Tests that missing required fields raise ConfigValidationError."""

    def test_missing_supervisor(self):
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config({})
        assert "Missing required section: 'supervisor'" in exc_info.value.errors

    def test_missing_supervisor_name(self):
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config({"supervisor": {"systemPrompt": "Hello."}})
        assert any("supervisor: missing required field 'name'" in e for e in exc_info.value.errors)

    def test_missing_supervisor_system_prompt(self):
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config({"supervisor": {"name": "Agent"}})
        assert any("supervisor: missing required field 'systemPrompt'" in e for e in exc_info.value.errors)

    def test_missing_tool_name(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "tools": [{"sourceDir": "tools/Foo"}],
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("missing required field 'name'" in e for e in exc_info.value.errors)

    def test_missing_subagent_name(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "subAgents": [{"systemPrompt": "Do stuff."}],
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("missing required field 'name'" in e for e in exc_info.value.errors)

    def test_missing_subagent_system_prompt(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "subAgents": [{"name": "Sub"}],
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("missing required field 'systemPrompt'" in e for e in exc_info.value.errors)

    def test_missing_memory_name(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "memory": {"description": "Some memory"},
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("memory: missing required field 'name'" in e for e in exc_info.value.errors)

    def test_missing_guardrail_name(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {"description": "Some guard"},
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("guardrail: missing required field 'name'" in e for e in exc_info.value.errors)


class TestCrossReferenceValidation:
    """Tests that broken cross-references are caught."""

    def test_supervisor_references_undefined_subagent(self):
        config = {
            "supervisor": {
                "name": "Agent",
                "systemPrompt": "Hello.",
                "subAgents": ["NonExistent"],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("references undefined sub-agent 'NonExistent'" in e for e in exc_info.value.errors)

    def test_supervisor_references_undefined_tool(self):
        config = {
            "supervisor": {
                "name": "Agent",
                "systemPrompt": "Hello.",
                "tools": ["NonExistent"],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("references undefined tool 'NonExistent'" in e for e in exc_info.value.errors)

    def test_subagent_references_undefined_tool(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "subAgents": [
                {"name": "Sub", "systemPrompt": "Hello.", "tools": ["MissingTool"]},
            ],
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("references undefined tool 'MissingTool'" in e for e in exc_info.value.errors)

    def test_valid_cross_references_pass(self):
        config = {
            "supervisor": {
                "name": "Agent",
                "systemPrompt": "Hello.",
                "subAgents": ["Sub"],
                "tools": ["MyTool"],
            },
            "subAgents": [
                {"name": "Sub", "systemPrompt": "Hello.", "tools": ["MyTool"]},
            ],
            "tools": [{"name": "MyTool"}],
        }
        warnings = validate_config(config)
        assert isinstance(warnings, list)


class TestDuplicateNames:
    """Tests that duplicate names are caught."""

    def test_duplicate_tool_names(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "tools": [{"name": "Foo"}, {"name": "Foo"}],
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("duplicate tool name 'Foo'" in e for e in exc_info.value.errors)

    def test_duplicate_subagent_names(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "subAgents": [
                {"name": "Sub", "systemPrompt": "A."},
                {"name": "Sub", "systemPrompt": "B."},
            ],
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("duplicate sub-agent name 'Sub'" in e for e in exc_info.value.errors)


class TestEnumValidation:
    """Tests that invalid enum values are caught."""

    def test_invalid_content_filter_type(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {
                "name": "Guard",
                "contentFilters": [{"type": "INVALID", "inputStrength": "LOW", "outputStrength": "LOW"}],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("invalid type 'INVALID'" in e for e in exc_info.value.errors)

    def test_invalid_input_strength(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {
                "name": "Guard",
                "contentFilters": [{"type": "VIOLENCE", "inputStrength": "EXTREME", "outputStrength": "LOW"}],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("invalid inputStrength 'EXTREME'" in e for e in exc_info.value.errors)

    def test_invalid_output_strength(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {
                "name": "Guard",
                "contentFilters": [{"type": "HATE", "inputStrength": "HIGH", "outputStrength": "SUPER"}],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("invalid outputStrength 'SUPER'" in e for e in exc_info.value.errors)

    def test_invalid_topic_input_action(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {
                "name": "Guard",
                "denyTopics": [{"name": "T", "definition": "D", "inputAction": "DENY", "outputAction": "BLOCK"}],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("invalid inputAction 'DENY'" in e for e in exc_info.value.errors)

    def test_invalid_topic_output_action(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {
                "name": "Guard",
                "denyTopics": [{"name": "T", "definition": "D", "inputAction": "BLOCK", "outputAction": "REJECT"}],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("invalid outputAction 'REJECT'" in e for e in exc_info.value.errors)

    def test_valid_enums_pass(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {
                "name": "Guard",
                "contentFilters": [
                    {"type": "SEXUAL", "inputStrength": "NONE", "outputStrength": "NONE"},
                    {"type": "VIOLENCE", "inputStrength": "LOW", "outputStrength": "MEDIUM"},
                    {"type": "HATE", "inputStrength": "HIGH", "outputStrength": "HIGH"},
                    {"type": "INSULTS", "inputStrength": "MEDIUM", "outputStrength": "LOW"},
                    {"type": "MISCONDUCT", "inputStrength": "HIGH", "outputStrength": "HIGH"},
                    {"type": "PROMPT_ATTACK", "inputStrength": "HIGH", "outputStrength": "NONE"},
                ],
                "denyTopics": [
                    {"name": "T1", "definition": "D1", "inputAction": "BLOCK", "outputAction": "BLOCK"},
                    {"name": "T2", "definition": "D2", "inputAction": "LOG", "outputAction": "LOG"},
                ],
            },
        }
        warnings = validate_config(config)
        assert isinstance(warnings, list)


class TestUnknownKeys:
    """Tests that unknown keys produce warnings (not errors)."""

    def test_unknown_top_level_key(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "unknownSection": "value",
        }
        warnings = validate_config(config)
        assert any("Unknown top-level key: 'unknownSection'" in w for w in warnings)

    def test_unknown_supervisor_key(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello.", "foo": "bar"},
        }
        warnings = validate_config(config)
        assert any("supervisor: unknown key 'foo'" in w for w in warnings)

    def test_unknown_tool_key(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "tools": [{"name": "T", "runtime": "python3.12"}],
        }
        warnings = validate_config(config)
        assert any("unknown key 'runtime'" in w for w in warnings)

    def test_unknown_subagent_key(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "subAgents": [{"name": "S", "systemPrompt": "Hi.", "maxTokens": 100}],
        }
        warnings = validate_config(config)
        assert any("unknown key 'maxTokens'" in w for w in warnings)


class TestDenyTopicValidation:
    """Tests for deny topic required fields."""

    def test_missing_deny_topic_name(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {
                "name": "Guard",
                "denyTopics": [{"definition": "D", "inputAction": "BLOCK", "outputAction": "BLOCK"}],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("missing required field 'name'" in e for e in exc_info.value.errors)

    def test_missing_deny_topic_definition(self):
        config = {
            "supervisor": {"name": "Agent", "systemPrompt": "Hello."},
            "guardrail": {
                "name": "Guard",
                "denyTopics": [{"name": "T", "inputAction": "BLOCK", "outputAction": "BLOCK"}],
            },
        }
        with pytest.raises(ConfigValidationError) as exc_info:
            validate_config(config)
        assert any("missing required field 'definition'" in e for e in exc_info.value.errors)
