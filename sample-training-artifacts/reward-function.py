"""
Sample Reward Function for AI League Dungeon Pathfinding Fine-Tuning

This reward function evaluates agent responses during reinforcement learning
fine-tuning for the dungeon pathfinding game. It scores responses based on:
- Correctness of the chosen move (valid and leads toward the goal)
- Quality of reasoning (considers obstacles, traps, keys)
- Token efficiency (penalizes verbose responses)

Usage:
    This file is used as a reward function during SageMaker fine-tuning jobs
    with reinforcement learning from human feedback (RLHF) or similar
    reward-model-based training approaches.

    The reward function is called for each generated response during training
    and returns a scalar reward value that guides the model optimization.
"""

import re
from typing import Optional


# Valid moves in the dungeon grid
VALID_MOVES = {"UP", "DOWN", "LEFT", "RIGHT"}

# Grid cell types
CELL_OPEN = "."
CELL_WALL = "#"
CELL_TRAP = "T"
CELL_KEY = "K"
CELL_DOOR = "D"
CELL_START = "S"
CELL_EXIT = "E"


def reward_function(prompt: str, completion: str) -> float:
    """
    Compute a reward score for a dungeon pathfinding agent response.

    Args:
        prompt: The input prompt containing the grid state and question.
        completion: The model's generated response with move choice and reasoning.

    Returns:
        A float reward value between -1.0 and 1.0 where:
        - 1.0 = optimal move with clear reasoning
        - 0.5 = valid move with some reasoning
        - 0.0 = valid move but poor/no reasoning
        - -0.5 = invalid move or move into wall
        - -1.0 = no recognizable move or completely off-topic
    """
    reward = 0.0

    # Extract the chosen move from the completion
    chosen_move = extract_move(completion)
    if chosen_move is None:
        return -1.0

    # Parse the grid from the prompt
    grid = parse_grid(prompt)
    position = parse_position(prompt)
    exit_pos = find_cell(grid, CELL_EXIT)

    if grid is None or position is None:
        # Can't evaluate without grid context, give neutral score for valid format
        return 0.0

    # Check if the move is valid (not into a wall or out of bounds)
    new_pos = apply_move(position, chosen_move)
    if not is_valid_position(new_pos, grid):
        return -0.5

    cell_at_new_pos = grid[new_pos[0]][new_pos[1]]
    if cell_at_new_pos == CELL_WALL:
        return -0.5

    # Move is valid - base reward
    reward = 0.3

    # Bonus for moving toward the exit (Manhattan distance reduction)
    if exit_pos is not None:
        old_distance = manhattan_distance(position, exit_pos)
        new_distance = manhattan_distance(new_pos, exit_pos)
        if new_distance < old_distance:
            reward += 0.2

    # Bonus for avoiding traps
    if cell_at_new_pos == CELL_TRAP:
        reward -= 0.2  # Penalty for stepping on trap
    elif has_trap_avoidance_reasoning(completion):
        reward += 0.1  # Bonus for reasoning about traps

    # Bonus for key collection reasoning when keys/doors are present
    if has_key_door_reasoning(completion, grid):
        reward += 0.1

    # Bonus for concise responses (token efficiency)
    word_count = len(completion.split())
    if word_count <= 80:
        reward += 0.1  # Concise and effective
    elif word_count > 200:
        reward -= 0.1  # Too verbose, wasting tokens

    # Bonus for structured reasoning (mentions "Reasoning:" section)
    if "Reasoning:" in completion or "reasoning:" in completion:
        reward += 0.1

    # Clamp reward to [-1.0, 1.0]
    return max(-1.0, min(1.0, reward))


def extract_move(completion: str) -> Optional[str]:
    """Extract the chosen move from the model's response."""
    # Look for "Move: DIRECTION" pattern
    match = re.search(r"Move:\s*(UP|DOWN|LEFT|RIGHT)", completion, re.IGNORECASE)
    if match:
        return match.group(1).upper()

    # Fallback: look for standalone direction words at the start
    for move in VALID_MOVES:
        if completion.strip().upper().startswith(move):
            return move

    return None


def parse_grid(prompt: str) -> Optional[list]:
    """Parse the grid from the prompt text."""
    lines = prompt.strip().split("\n")
    grid = []
    grid_started = False

    for line in lines:
        stripped = line.strip()
        # Grid lines contain cell symbols separated by spaces
        if all(c in ".#TKDSE " for c in stripped) and len(stripped) > 2:
            cells = stripped.split()
            if all(
                c in {CELL_OPEN, CELL_WALL, CELL_TRAP, CELL_KEY,
                      CELL_DOOR, CELL_START, CELL_EXIT}
                for c in cells
            ):
                grid.append(cells)
                grid_started = True
        elif grid_started:
            break  # Stop after grid ends

    return grid if grid else None


def parse_position(prompt: str) -> Optional[tuple]:
    """Extract current position from the prompt."""
    match = re.search(r"Your position:\s*\((\d+),\s*(\d+)\)", prompt)
    if match:
        return (int(match.group(1)), int(match.group(2)))
    return None


def find_cell(grid: Optional[list], cell_type: str) -> Optional[tuple]:
    """Find the position of a specific cell type in the grid."""
    if grid is None:
        return None
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if cell == cell_type:
                return (r, c)
    return None


def apply_move(position: tuple, move: str) -> tuple:
    """Apply a move to a position and return the new position."""
    row, col = position
    if move == "UP":
        return (row - 1, col)
    elif move == "DOWN":
        return (row + 1, col)
    elif move == "LEFT":
        return (row, col - 1)
    elif move == "RIGHT":
        return (row, col + 1)
    return position


def is_valid_position(position: tuple, grid: list) -> bool:
    """Check if a position is within grid bounds."""
    row, col = position
    if row < 0 or col < 0:
        return False
    if row >= len(grid) or col >= len(grid[0]):
        return False
    return True


def manhattan_distance(pos1: tuple, pos2: tuple) -> int:
    """Calculate Manhattan distance between two positions."""
    return abs(pos1[0] - pos2[0]) + abs(pos1[1] - pos2[1])


def has_trap_avoidance_reasoning(completion: str) -> bool:
    """Check if the response mentions trap avoidance strategy."""
    trap_keywords = ["trap", "avoid", "penalty", "cost", "token"]
    completion_lower = completion.lower()
    return sum(1 for kw in trap_keywords if kw in completion_lower) >= 2


def has_key_door_reasoning(completion: str, grid: Optional[list]) -> bool:
    """Check if response reasons about keys/doors when they exist in the grid."""
    if grid is None:
        return False

    has_key = any(CELL_KEY in row for row in grid)
    has_door = any(CELL_DOOR in row for row in grid)

    if not (has_key or has_door):
        return False

    key_door_keywords = ["key", "door", "unlock", "collect", "locked"]
    completion_lower = completion.lower()
    return any(kw in completion_lower for kw in key_door_keywords)


# Entry point for SageMaker reward function evaluation
def handler(event: dict) -> dict:
    """
    SageMaker reward function handler.

    Args:
        event: Contains 'prompt' and 'completion' fields.

    Returns:
        Dictionary with 'reward' scalar value.
    """
    prompt = event.get("prompt", "")
    completion = event.get("completion", "")

    reward = reward_function(prompt, completion)

    return {"reward": reward}
