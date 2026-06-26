import json
import re
from typing import Dict, Any, List, Optional


def extract_path_from_response(response: str) -> Optional[List[str]]:
    """
    Extract a path array from the model's response.
    Looks for JSON arrays of direction strings.
    """
    if not response:
        return None

    # Try to find a JSON array in the response
    match = re.search(
        r'\[([^\[\]]*"(?:up|down|left|right)"[^\[\]]*)\]',
        response, re.DOTALL
    )
    if match:
        try:
            arr = json.loads('[' + match.group(1) + ']')
            if all(isinstance(x, str) for x in arr):
                return arr
        except json.JSONDecodeError:
            pass

    # Fallback: try parsing the whole response as JSON
    try:
        parsed = json.loads(response.strip())
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict) and 'path' in parsed:
            return parsed['path']
    except json.JSONDecodeError:
        pass

    return None


def reward_function(sample: Dict[str, Any], index: int) -> Dict[str, Any]:
    """
    Reward function for faithful tool output reproduction.
    """
    messages = sample.get('messages', sample.get('prompt', []))

    # Get the last assistant message (the one after tool response)
    response = ""
    for msg in messages:
        if msg.get('role') == 'assistant':
            content = msg.get('content', '')
            if isinstance(content, list):
                content = ' '.join(str(b.get('text', b)) for b in content)
            if isinstance(content, str):
                response = content

    # Parse ground truth
    ground_truth_str = ""
    if 'reward_model' in sample:
        ground_truth_str = sample['reward_model'].get('ground_truth', '')

    ground_truth = {}
    if ground_truth_str:
        try:
            ground_truth = (
                json.loads(ground_truth_str)
                if isinstance(ground_truth_str, str)
                else ground_truth_str
            )
        except json.JSONDecodeError:
            ground_truth = {}

    expected_path = ground_truth.get('path', [])
    expected_steps = ground_truth.get('steps', len(expected_path))

    # Extract path from model response
    predicted_path = extract_path_from_response(response)

    # Scoring
    has_array = predicted_path is not None
    exact_match = False
    length_match = False
    element_accuracy = 0.0
    dropped_steps = 0
    added_steps = 0

    if has_array and expected_path:
        pred_len = len(predicted_path)
        exp_len = len(expected_path)
        exact_match = predicted_path == expected_path
        length_match = pred_len == exp_len

        if not exact_match:
            dropped_steps = max(0, exp_len - pred_len)
            added_steps = max(0, pred_len - exp_len)
            min_len = min(pred_len, exp_len)
            if min_len > 0:
                matches = sum(
                    1 for a, b in zip(predicted_path, expected_path) if a == b
                )
                element_accuracy = matches / exp_len

    # Aggregate reward
    if exact_match:
        aggregate_reward = 1.0
    elif has_array and expected_path:
        if length_match:
            aggregate_reward = 0.3 * element_accuracy
        else:
            length_ratio = (
                min(len(predicted_path), len(expected_path))
                / max(len(predicted_path), len(expected_path))
                if predicted_path else 0
            )
            aggregate_reward = 0.2 * element_accuracy * length_ratio
    elif has_array:
        aggregate_reward = 0.1
    else:
        if response and any(
            d in response.lower() for d in ['up', 'down', 'left', 'right']
        ):
            aggregate_reward = 0.05
        else:
            aggregate_reward = 0.0

    aggregate_reward = max(0.0, min(1.0, aggregate_reward))

    # Metrics
    metrics = [
        {'name': 'exact_match', 'value': float(exact_match), 'type': 'Reward'},
        {'name': 'has_array', 'value': float(has_array), 'type': 'Metric'},
        {'name': 'length_match', 'value': float(length_match), 'type': 'Metric'},
        {'name': 'element_accuracy', 'value': float(element_accuracy), 'type': 'Metric'},
        {'name': 'expected_steps', 'value': float(expected_steps), 'type': 'Metric'},
        {'name': 'predicted_steps', 'value': float(len(predicted_path) if predicted_path else 0), 'type': 'Metric'},
        {'name': 'dropped_steps', 'value': float(dropped_steps), 'type': 'Metric'},
        {'name': 'added_steps', 'value': float(added_steps), 'type': 'Metric'},
        {'name': 'response_length', 'value': float(len(response)), 'type': 'Metric'},
    ]

    sample_id = sample.get(
        'id', sample.get('extra_info', {}).get('index', f'sample-{index:03d}')
    )

    return {
        'id': str(sample_id),
        'aggregate_reward_score': float(aggregate_reward),
        'metrics_list': metrics
    }


def lambda_handler(event, context):
    """
    Lambda entry point for Bedrock RFT.
    Receives a list of trajectories and returns a list of scored results.
    """
    trajectories = event if isinstance(event, list) else event.get("trajectories", [])
    results = []
    for index, sample in enumerate(trajectories):
        result = reward_function(sample, index)
        results.append(result)
    return results