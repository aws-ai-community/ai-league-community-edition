"""Prompt Formatter — constructs the navigation prompt for the AgentCore Runtime.

Ported from reference implementation (prompt_formatter.py).
Provides coordinate conversion utilities and the default navigation prompt
format used by the supervisor agent for pathfinding.
"""

import json
from typing import Any, Dict, Optional, Tuple


def coords_to_label(row: int, col: int) -> str:
    """Convert 0-indexed (row, col) coordinates to a human-readable label.

    Column maps to a letter (A=0, B=1, ..., Z=25).
    Row maps to a 1-indexed number (1=0, 2=1, ...).

    Examples:
        (0, 0) → 'A1'
        (0, 3) → 'D1'
        (2, 1) → 'B3'

    Args:
        row: Zero-indexed row number.
        col: Zero-indexed column number.

    Returns:
        A coordinate label string like 'A1', 'D1', 'B3'.
    """
    col_letter = chr(ord("A") + col)
    row_number = row + 1
    return f"{col_letter}{row_number}"


def label_to_coords(label: str) -> Optional[Tuple[int, int]]:
    """Convert a coordinate label (e.g., 'B3') back to 0-indexed (row, col).

    This is the inverse of coords_to_label. The label format is a single
    uppercase letter followed by a positive integer.

    Examples:
        'A1' → (0, 0)
        'D1' → (0, 3)
        'B3' → (2, 1)

    Args:
        label: A coordinate label string (case-insensitive).

    Returns:
        A (row, col) tuple, or None if the label is invalid.
    """
    if not label or len(label) < 2:
        return None

    col_char = label[0].upper()
    if not col_char.isalpha():
        return None

    row_str = label[1:]
    if not row_str.isdigit():
        return None

    row_number = int(row_str)
    if row_number < 1:
        return None

    col = ord(col_char) - ord("A")
    row = row_number - 1
    return (row, col)


def format_navigation_prompt(map_data: Dict[str, Any]) -> str:
    """Format the default navigation prompt for the supervisor agent.

    Constructs the prompt sent to the AgentCore Runtime containing:
    - The player start position as a coordinate label
    - Instructions for the coordinate format (column letter + row number)
    - Instructions for the map object's coordinate format ([rowIndex, columnIndex])
    - Only the grid array (matching the reference app format)

    Args:
        map_data: Full map document with grid, challenges, playerStart, etc.

    Returns:
        The navigation prompt string to send to the AgentCore Runtime.
    """
    player_start = map_data.get("playerStart", {"row": 0, "col": 0})
    start_label = coords_to_label(player_start["row"], player_start["col"])
    grid = map_data.get("grid", [])
    grid_json = json.dumps(grid)
    return (
        f"Find a path from position {start_label}, where the position is "
        f"formatted as {{column}}{{row}}. {{column}} is a letter starting "
        f"with A, and {{row}} is a number starting with 1. The map object's "
        f"coordinates are formatted as [{{rowIndex}},{{columnIndex}}], where "
        f"{{rowIndex}} is the row number starting with 0, and "
        f"{{columnIndex}} is the column number starting with 0. The path "
        f"should find the treasure on this map: {grid_json}."
    )
