"""Path Parser — extracts navigation path from agent response.

Ported from reference implementation (game_runner.py::_parse_navigation_path).
Supports multiple response formats: JSON path objects, JSON arrays of coordinates
or labels, direction strings, and comma-separated coordinate labels.
"""

import json
import re
from typing import List, Optional, Tuple


def label_to_coords(label: str) -> Optional[Tuple[int, int]]:
    """Convert a single coordinate label (e.g., 'B3') to 0-indexed (row, col).

    The label format is {column_letter}{row_number} where:
    - Column letter: A=0, B=1, ..., Z=25
    - Row number: 1-indexed (1=row 0, 2=row 1, ...)

    Examples:
        'A1' → (0, 0)
        'B3' → (2, 1)
        'D1' → (0, 3)

    Args:
        label: A coordinate label string (case-insensitive).

    Returns:
        A (row, col) tuple, or None if the label is invalid.
    """
    if not label or len(label) < 2:
        return None

    match = re.match(r"^([A-Z])(\d+)$", label.strip().upper())
    if not match:
        return None

    col = ord(match.group(1)) - ord("A")
    row_number = int(match.group(2))
    if row_number < 1:
        return None

    row = row_number - 1
    return (row, col)


def parse_navigation_path(
    response_text: str, start: Tuple[int, int] = (0, 0)
) -> Optional[List[Tuple[int, int]]]:
    """Parse agent response into a list of (row, col) coordinates.

    Attempts parsing in priority order (matching the reference implementation):
    1. JSON object with "path" key: {"path": [...]}
    2. JSON array [...]:
       - If elements are direction strings ("up", "down", etc.) → convert to coords
       - If elements are [row, col] arrays → use directly
       - If elements are coordinate labels ("A1", "B3") → parse labels
    3. Direction word extraction: find all \\b(up|down|left|right)\\b in text

    Args:
        response_text: The raw text response from the agent.
        start: Starting position (row, col) for direction-based paths.
            Defaults to (0, 0).

    Returns:
        List of (row, col) tuples representing the path, or None if parsing fails.
    """
    if not response_text:
        return None

    # 1. Try to find {"path": [...]} JSON object
    path = _try_json_path_object(response_text, start)
    if path is not None:
        return path

    # 2. Try JSON array [...]
    path = _try_json_array(response_text, start)
    if path is not None:
        return path

    # 3. Try direction word extraction from free text
    path = _try_direction_extraction(response_text, start)
    if path is not None:
        return path

    return None


def _try_json_path_object(
    text: str, start: Tuple[int, int]
) -> Optional[List[Tuple[int, int]]]:
    """Try to parse a JSON object containing a "path" key.

    Matches patterns like: {"path": [[0,0], [1,0], [1,1]]}
    or: {"path": ["down", "right", "right"]}
    """
    json_match = re.search(
        r'\{[^{}]*"path"\s*:\s*\[.*?\][^{}]*\}', text, re.DOTALL
    )
    if not json_match:
        return None

    try:
        parsed = json.loads(json_match.group())
    except json.JSONDecodeError:
        return None

    path_arr = parsed.get("path", [])
    if not path_arr or not isinstance(path_arr, list):
        return None

    # If elements are direction strings
    if isinstance(path_arr[0], str) and path_arr[0].lower() in (
        "up",
        "down",
        "left",
        "right",
    ):
        return _directions_to_coords(path_arr, start)

    # If elements are [row, col] arrays
    if isinstance(path_arr[0], (list, tuple)):
        return _array_pairs_to_coords(path_arr)

    # If elements are coordinate labels
    if isinstance(path_arr[0], str):
        return _labels_to_coords(path_arr)

    return None


def _try_json_array(
    text: str, start: Tuple[int, int]
) -> Optional[List[Tuple[int, int]]]:
    """Try to parse a JSON array from the response text.

    Supports:
    - [[0,0], [1,0], [1,1]] — coordinate pairs
    - ["up", "down", "left", "right"] — direction strings
    - ["A1", "A2", "B2"] — coordinate labels
    """
    # Find the first '[' and attempt to parse progressively larger substrings
    # ending at each ']' to find a valid JSON array (handles nested arrays)
    first_bracket = text.find("[")
    if first_bracket == -1:
        return None

    arr = None
    search_start = first_bracket
    while search_start < len(text):
        end_bracket = text.find("]", search_start + 1)
        if end_bracket == -1:
            break
        candidate = text[first_bracket : end_bracket + 1]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                arr = parsed
                break
        except json.JSONDecodeError:
            search_start = end_bracket
            continue

    if not arr:
        return None

    # Direction strings
    if isinstance(arr[0], str) and arr[0].lower() in (
        "up",
        "down",
        "left",
        "right",
    ):
        return _directions_to_coords(arr, start)

    # [row, col] coordinate pairs
    if isinstance(arr[0], (list, tuple)):
        return _array_pairs_to_coords(arr)

    # Coordinate labels (e.g., "A1", "B3")
    if isinstance(arr[0], str):
        coords = _labels_to_coords(arr)
        if coords:
            return coords

    return None


def _try_direction_extraction(
    text: str, start: Tuple[int, int]
) -> Optional[List[Tuple[int, int]]]:
    """Extract direction words from free text and convert to coordinates.

    Finds all occurrences of 'up', 'down', 'left', 'right' in the text.
    Requires at least 2 direction words to form a valid path.
    """
    directions = re.findall(r"\b(up|down|left|right)\b", text.lower())
    if len(directions) < 2:
        return None

    return _directions_to_coords(directions, start)


def _directions_to_coords(
    directions: List[str], start: Tuple[int, int]
) -> List[Tuple[int, int]]:
    """Convert a list of direction strings to coordinate path.

    Args:
        directions: List of direction strings ('up', 'down', 'left', 'right').
        start: Starting position (row, col).

    Returns:
        List of (row, col) tuples including the start position.
    """
    dir_map = {
        "up": (-1, 0),
        "down": (1, 0),
        "left": (0, -1),
        "right": (0, 1),
    }

    path = [start]
    r, c = start
    for d in directions:
        dr, dc = dir_map.get(d.lower(), (0, 0))
        nr, nc = r + dr, c + dc
        path.append((nr, nc))
        r, c = nr, nc

    return path


def _array_pairs_to_coords(
    arr: List,
) -> Optional[List[Tuple[int, int]]]:
    """Convert a list of [row, col] arrays to coordinate tuples.

    Args:
        arr: List of [row, col] pairs (lists or tuples).

    Returns:
        List of (row, col) tuples, or None if no valid pairs found.
    """
    result = []
    for item in arr:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            try:
                result.append((int(item[0]), int(item[1])))
            except (ValueError, TypeError):
                continue
    return result if result else None


def _labels_to_coords(labels: List[str]) -> Optional[List[Tuple[int, int]]]:
    """Convert a list of coordinate label strings to (row, col) tuples.

    Args:
        labels: List of coordinate labels like ["A1", "B3", "C2"].

    Returns:
        List of (row, col) tuples, or None if no valid labels found.
    """
    result = []
    for label in labels:
        match = re.match(r"^([A-Z])(\d+)$", label.strip().upper())
        if match:
            col = ord(match.group(1)) - ord("A")
            row = int(match.group(2)) - 1
            result.append((row, col))
    return result if result else None
