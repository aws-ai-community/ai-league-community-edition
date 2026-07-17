# Pathfinder Tool - AI League
# ============================
# BFS-based pathfinding Lambda for the AI League dungeon game.
# Supports "swift" (shortest path) and "get_coins" (greedy coin collection) strategies.
#
# This file is deployed as AgentCoreGatewayTool-Pathfinder.
# Handler entrypoint: lambda_handler.lambda_handler

import json
from collections import deque

CELL_POINTS = {"c7": 250}
COLLECTIBLE_COINS = {"c7"}
DIRECTIONS = [(-1, 0, "up"), (1, 0, "down"), (0, -1, "left"), (0, 1, "right")]


def lambda_handler(event, context):
    """
    AWS Lambda function for pathfinding using Swift path strategy by default.
    Handles both API Gateway format and direct AgentCore Gateway format.

    ---
    Tool: route
    Description: Route calculator for known maps. Finds optimal path from start to treasure.
    Parameters:
        game_map     (required) - the 2D grid array as JSON string or list
        start_pos    (optional) - starting position as [row, col], defaults to [0,0] or "start" cell
        strategy     (required) - routing mode: swift, get_coins
    ---

    ## Map Definitions
        - "wall": non-walkable cell
        - "treasure": target cell to reach
        - "normal": walkable cell with no special properties
        - "start": the start cell of your avatar, acts as normal cell
        - "c7": Coins that increase score when collected with no challenge
        - "c8": Spikes that reduce health traveled over

    ## Strategies
        swift     - BFS shortest path to treasure (default)
        get_coins - Greedily collect c7 coins on the way to treasure
    """

    try:
        if 'body' in event:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            body = event

        print(f"DEBUG: start_pos={body.get('start_pos')} grid_size={len(str(body.get('game_map', '')))} chars")
        game_map = body.get('game_map', [])
        start_pos = body.get('start_pos', [0, 0])
        strategy = body.get('strategy', 'swift')
        print(f"DEBUG: strategy={strategy}")

        # Robustly parse game_map
        map_object = None
        if isinstance(game_map, str):
            game_map = game_map.strip()
            first_bracket = -1
            for i, ch in enumerate(game_map):
                if ch in ('[', '{'):
                    first_bracket = i
                    break
            last_bracket = -1
            for i in range(len(game_map) - 1, -1, -1):
                if game_map[i] in (']', '}'):
                    last_bracket = i
                    break
            if first_bracket >= 0 and last_bracket > first_bracket:
                game_map = game_map[first_bracket:last_bracket + 1]
            try:
                game_map = json.loads(game_map)
            except json.JSONDecodeError:
                return _err(400, f'game_map is not valid JSON: {game_map[:100]}')

        if isinstance(game_map, dict):
            map_object = game_map
            if 'grid' in game_map:
                game_map = game_map['grid']
            elif 'game_map' in game_map:
                game_map = game_map['game_map']
            elif 'map' in game_map:
                game_map = game_map['map']

        # Parse start_pos if it's a string
        if isinstance(start_pos, str):
            try:
                start_pos = json.loads(start_pos)
            except json.JSONDecodeError:
                start_pos = [0, 0]

        # If map_object had a playerStart field, use it
        if map_object and 'playerStart' in map_object:
            ps = map_object['playerStart']
            if isinstance(ps, dict) and 'row' in ps and 'col' in ps:
                start_pos = [int(ps['row']), int(ps['col'])]
                print(f"DEBUG: Using playerStart from map object: {start_pos}")

        # Fallback: find "start" cell in the grid
        if not map_object or 'playerStart' not in (map_object or {}):
            for r_idx, row in enumerate(game_map):
                for c_idx, cell in enumerate(row):
                    if cell == 'start':
                        start_pos = [r_idx, c_idx]
                        print(f"DEBUG: Found 'start' cell at: {start_pos}")
                        break
                else:
                    continue
                break

        if not game_map or not isinstance(game_map, list):
            return _err(400, 'Missing or invalid game_map')

        rows, cols = len(game_map), len(game_map[0])
        treasure = None
        for r in range(rows):
            for c in range(cols):
                if game_map[r][c] == 'treasure':
                    treasure = (r, c)
                    break
            if treasure:
                break

        if not treasure:
            return _err(400, 'No treasure found on map')

        if strategy == 'get_coins':
            path = get_coins_path(game_map, rows, cols, tuple(start_pos), treasure)
        else:
            path = swift_path(game_map, rows, cols, tuple(start_pos), treasure)

        result = {'path': path, 'steps': len(path), 'start_position': start_pos}
        print(f"RESULT: strategy={strategy} steps={len(path)}")
        return {'statusCode': 200, 'body': json.dumps(result)}

    except Exception as e:
        print(f"ERROR: {e}")
        return _err(500, str(e))


def _err(code, msg):
    return {'statusCode': code, 'body': json.dumps({'error': msg})}


def _bfs(game_map, rows, cols, start, goal):
    """BFS shortest path between two points."""
    queue = deque([(start[0], start[1], [])])
    visited = {(start[0], start[1])}
    while queue:
        r, c, path = queue.popleft()
        if (r, c) == goal:
            return path
        for dr, dc, move in DIRECTIONS:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and game_map[nr][nc] != 'wall' and (nr, nc) not in visited:
                visited.add((nr, nc))
                queue.append((nr, nc, path + [move]))
    return None


def swift_path(game_map, rows, cols, start, treasure):
    """BFS shortest path to treasure."""
    return _bfs(game_map, rows, cols, start, treasure) or []


def get_coins_path(game_map, rows, cols, start, treasure):
    """Greedily BFS to best coins-per-step c7 cell, then BFS to treasure."""
    board = [row[:] for row in game_map]
    r, c = start
    full_path = []

    for _ in range(50):
        queue = deque([(r, c, [])])
        visited = {(r, c)}
        targets = []
        while queue:
            cr, cc, p = queue.popleft()
            if board[cr][cc] in COLLECTIBLE_COINS and (cr, cc) != (r, c):
                dist = max(len(p), 1)
                targets.append((dist, p, cr, cc))
            for dr, dc, move in DIRECTIONS:
                nr, nc = cr + dr, cc + dc
                if 0 <= nr < rows and 0 <= nc < cols and board[nr][nc] != 'wall' and (nr, nc) not in visited:
                    visited.add((nr, nc))
                    queue.append((nr, nc, p + [move]))

        if not targets:
            break
        targets.sort()
        _, path_to, r, c = targets[0]
        full_path.extend(path_to)
        board[r][c] = 'normal'

    path_end = _bfs(board, rows, cols, (r, c), treasure)
    if path_end is not None:
        full_path.extend(path_end)
        return full_path
    return swift_path(game_map, rows, cols, start, treasure)
