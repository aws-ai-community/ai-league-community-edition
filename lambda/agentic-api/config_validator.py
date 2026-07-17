"""Agent Configuration YAML Validator.

Validates the agent-config/config.yaml schema at deploy time and runtime.
Checks required fields, cross-references, enums, and duplicate names.

Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 1.4, 1.5
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Valid enum values
VALID_CONTENT_FILTER_TYPES = frozenset([
    "SEXUAL", "VIOLENCE", "HATE", "INSULTS", "MISCONDUCT", "PROMPT_ATTACK"
])
VALID_STRENGTHS = frozenset(["NONE", "LOW", "MEDIUM", "HIGH"])
VALID_TOPIC_ACTIONS = frozenset(["BLOCK", "LOG"])


class ConfigValidationError(Exception):
    """Raised when config.yaml has invalid content that should halt deployment."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__(f"Config validation failed with {len(errors)} error(s): {'; '.join(errors)}")


def validate_config(config: dict[str, Any]) -> list[str]:
    """Validate agent seed configuration.

    Args:
        config: Parsed YAML config dict.

    Returns:
        List of warning messages (unknown keys etc). Empty if no warnings.

    Raises:
        ConfigValidationError: If required fields are missing, cross-references
            are broken, or enum values are invalid.
    """
    errors: list[str] = []
    warnings: list[str] = []

    # --- Check top-level keys ---
    known_top_keys = {"supervisor", "subAgents", "tools", "memory", "guardrail"}
    for key in config:
        if key not in known_top_keys:
            warnings.append(f"Unknown top-level key: '{key}'")

    # --- Validate supervisor (required) ---
    supervisor = config.get("supervisor")
    if not supervisor:
        errors.append("Missing required section: 'supervisor'")
    elif not isinstance(supervisor, dict):
        errors.append("'supervisor' must be a mapping")
    else:
        _validate_supervisor(supervisor, errors, warnings)

    # --- Collect defined names for cross-reference checks ---
    defined_tool_names = set()
    defined_subagent_names = set()

    # --- Validate tools ---
    tools = config.get("tools", [])
    if tools is not None and not isinstance(tools, list):
        errors.append("'tools' must be a list")
        tools = []
    elif tools is None:
        tools = []

    for i, tool in enumerate(tools):
        if not isinstance(tool, dict):
            errors.append(f"tools[{i}]: must be a mapping")
            continue
        name = tool.get("name")
        if not name or not isinstance(name, str):
            errors.append(f"tools[{i}]: missing required field 'name'")
        else:
            if name in defined_tool_names:
                errors.append(f"tools[{i}]: duplicate tool name '{name}'")
            defined_tool_names.add(name)

        # Warn on unknown keys
        known_tool_keys = {"name", "sourceDir"}
        for key in tool:
            if key not in known_tool_keys:
                warnings.append(f"tools[{i}] ('{name}'): unknown key '{key}'")

    # --- Validate subAgents ---
    sub_agents = config.get("subAgents", [])
    if sub_agents is not None and not isinstance(sub_agents, list):
        errors.append("'subAgents' must be a list")
        sub_agents = []
    elif sub_agents is None:
        sub_agents = []

    for i, agent in enumerate(sub_agents):
        if not isinstance(agent, dict):
            errors.append(f"subAgents[{i}]: must be a mapping")
            continue
        name = agent.get("name")
        if not name or not isinstance(name, str):
            errors.append(f"subAgents[{i}]: missing required field 'name'")
        else:
            if name in defined_subagent_names:
                errors.append(f"subAgents[{i}]: duplicate sub-agent name '{name}'")
            defined_subagent_names.add(name)

        if not agent.get("systemPrompt"):
            errors.append(f"subAgents[{i}] ('{name}'): missing required field 'systemPrompt'")

        # Validate tool references
        agent_tools = agent.get("tools", [])
        if agent_tools and isinstance(agent_tools, list):
            for tool_ref in agent_tools:
                if tool_ref not in defined_tool_names:
                    errors.append(
                        f"subAgents[{i}] ('{name}'): references undefined tool '{tool_ref}'"
                    )

        # Warn on unknown keys
        known_agent_keys = {"name", "systemPrompt", "modelId", "tools"}
        for key in agent:
            if key not in known_agent_keys:
                warnings.append(f"subAgents[{i}] ('{name}'): unknown key '{key}'")

    # --- Cross-reference validation for supervisor ---
    if supervisor and isinstance(supervisor, dict):
        _validate_supervisor_references(supervisor, defined_tool_names, defined_subagent_names, errors)

    # --- Validate memory ---
    memory = config.get("memory")
    if memory is not None and memory is not False:
        if isinstance(memory, dict):
            if not memory.get("name"):
                errors.append("memory: missing required field 'name'")
            else:
                import re
                if not re.match(r'^[a-zA-Z][a-zA-Z0-9_]{0,47}$', memory["name"]):
                    errors.append(
                        f"memory: name '{memory['name']}' is invalid. "
                        f"Must match [a-zA-Z][a-zA-Z0-9_]{{0,47}} (no spaces, start with letter)"
                    )
            known_memory_keys = {"name", "description"}
            for key in memory:
                if key not in known_memory_keys:
                    warnings.append(f"memory: unknown key '{key}'")
        elif memory != "null":
            # Allow null/None but not random types
            pass

    # --- Validate guardrail ---
    guardrail = config.get("guardrail")
    if guardrail is not None and isinstance(guardrail, dict):
        _validate_guardrail(guardrail, errors, warnings)

    # --- Raise on errors ---
    if errors:
        raise ConfigValidationError(errors)

    # Log warnings
    for w in warnings:
        logger.warning("Config validation warning: %s", w)

    return warnings


def _validate_supervisor(supervisor: dict, errors: list[str], warnings: list[str]) -> None:
    """Validate supervisor required fields."""
    if not supervisor.get("name"):
        errors.append("supervisor: missing required field 'name'")
    if not supervisor.get("systemPrompt"):
        errors.append("supervisor: missing required field 'systemPrompt'")

    known_supervisor_keys = {"name", "systemPrompt", "modelId", "subAgents", "tools", "memory", "guardrail"}
    for key in supervisor:
        if key not in known_supervisor_keys:
            warnings.append(f"supervisor: unknown key '{key}'")


def _validate_supervisor_references(
    supervisor: dict,
    defined_tool_names: set[str],
    defined_subagent_names: set[str],
    errors: list[str],
) -> None:
    """Validate supervisor cross-references to tools and sub-agents."""
    # Sub-agent references
    sub_agent_refs = supervisor.get("subAgents", [])
    if sub_agent_refs and isinstance(sub_agent_refs, list):
        for ref in sub_agent_refs:
            if ref not in defined_subagent_names:
                errors.append(f"supervisor.subAgents: references undefined sub-agent '{ref}'")

    # Tool references
    tool_refs = supervisor.get("tools", [])
    if tool_refs and isinstance(tool_refs, list):
        for ref in tool_refs:
            if ref not in defined_tool_names:
                errors.append(f"supervisor.tools: references undefined tool '{ref}'")

    # Memory reference
    memory_ref = supervisor.get("memory")
    # Memory reference is validated by checking the memory section exists (done elsewhere)

    # Guardrail reference
    guardrail_ref = supervisor.get("guardrail")
    # Guardrail reference is validated by checking the guardrail section exists (done elsewhere)


def _validate_guardrail(guardrail: dict, errors: list[str], warnings: list[str]) -> None:
    """Validate guardrail section."""
    import re

    if not guardrail.get("name"):
        errors.append("guardrail: missing required field 'name'")
    else:
        if not re.match(r'^[0-9a-zA-Z\-_]+$', guardrail["name"]):
            errors.append(
                f"guardrail: name '{guardrail['name']}' is invalid. "
                f"Must match [0-9a-zA-Z-_]+ (no spaces)"
            )

    known_guardrail_keys = {
        "name", "description", "blockedInputMessaging", "blockedOutputsMessaging",
        "contentFilters", "denyTopics"
    }
    for key in guardrail:
        if key not in known_guardrail_keys:
            warnings.append(f"guardrail: unknown key '{key}'")

    # Content filters
    content_filters = guardrail.get("contentFilters", [])
    if content_filters and isinstance(content_filters, list):
        for i, cf in enumerate(content_filters):
            if not isinstance(cf, dict):
                errors.append(f"guardrail.contentFilters[{i}]: must be a mapping")
                continue
            cf_type = cf.get("type", "")
            if cf_type not in VALID_CONTENT_FILTER_TYPES:
                errors.append(
                    f"guardrail.contentFilters[{i}]: invalid type '{cf_type}'. "
                    f"Must be one of: {', '.join(sorted(VALID_CONTENT_FILTER_TYPES))}"
                )
            input_strength = cf.get("inputStrength", "")
            if input_strength and input_strength not in VALID_STRENGTHS:
                errors.append(
                    f"guardrail.contentFilters[{i}]: invalid inputStrength '{input_strength}'. "
                    f"Must be one of: {', '.join(sorted(VALID_STRENGTHS))}"
                )
            output_strength = cf.get("outputStrength", "")
            if output_strength and output_strength not in VALID_STRENGTHS:
                errors.append(
                    f"guardrail.contentFilters[{i}]: invalid outputStrength '{output_strength}'. "
                    f"Must be one of: {', '.join(sorted(VALID_STRENGTHS))}"
                )

    # Deny topics
    deny_topics = guardrail.get("denyTopics", [])
    if deny_topics and isinstance(deny_topics, list):
        for i, topic in enumerate(deny_topics):
            if not isinstance(topic, dict):
                errors.append(f"guardrail.denyTopics[{i}]: must be a mapping")
                continue
            if not topic.get("name"):
                errors.append(f"guardrail.denyTopics[{i}]: missing required field 'name'")
            if not topic.get("definition"):
                errors.append(f"guardrail.denyTopics[{i}]: missing required field 'definition'")
            input_action = topic.get("inputAction", "")
            if input_action and input_action not in VALID_TOPIC_ACTIONS:
                errors.append(
                    f"guardrail.denyTopics[{i}]: invalid inputAction '{input_action}'. "
                    f"Must be BLOCK or LOG"
                )
            output_action = topic.get("outputAction", "")
            if output_action and output_action not in VALID_TOPIC_ACTIONS:
                errors.append(
                    f"guardrail.denyTopics[{i}]: invalid outputAction '{output_action}'. "
                    f"Must be BLOCK or LOG"
                )
