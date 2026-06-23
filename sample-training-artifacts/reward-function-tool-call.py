import json
import re
import boto3
from typing import Dict, Any, Optional

# Initialize Lambda client
lambda_client = boto3.client('lambda', region_name='us-east-1')


def extract_tool_call(response: str) -> Optional[Dict[str, Any]]:
    """
    Extract tool call from model's raw text output.

    Supports:
    1. Qwen native: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
    2. Legacy: [TOOL_CALL]{"tool": "...", "parameters": {...}}[/TOOL_CALL]
    3. Raw JSON with tool/name key as fallback
    """
    if not response:
        return None

    # 1. Qwen native: <tool_call>...</tool_call>
    match = re.search(r'<tool_call>\s*(.*?)\s*</tool_call>', response, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(1).strip())
            name = parsed.get('name', '')
            arguments = parsed.get('arguments', {})
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except:
                    arguments = {}
            return {'tool': name, 'parameters': arguments, 'format': 'qwen_native'}
        except json.JSONDecodeError:
            pass

    # 2. Legacy: [TOOL_CALL]...[/TOOL_CALL]
    match = re.search(r'\[TOOL_CALL\]\s*(.*?)\s*\[/TOOL_CALL\]', response, re.DOTALL | re.IGNORECASE)
    if match:
        try:
            parsed = json.loads(match.group(1).strip())
            return {
                'tool': parsed.get('tool', parsed.get('name', '')),
                'parameters': parsed.get('parameters', parsed.get('arguments', {})),
                'format': 'legacy_tags',
            }
        except json.JSONDecodeError:
            pass

    # 3. Fallback: raw JSON with "name"/"tool" key anywhere in response
    json_pattern = r'\{[^{}]*"(?:name|tool)"[^{}]*\}'
    match = re.search(json_pattern, response, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            return {
                'tool': parsed.get('name', parsed.get('tool', '')),
                'parameters': parsed.get('arguments', parsed.get('parameters', {})),
                'format': 'raw_json',
            }
        except json.JSONDecodeError:
            pass

    return None


def extract_text_signals(response: str) -> Dict[str, Any]:
    """Extract soft signals from text when no structured tool call is found."""
    signals = {
        'mentions_tool_name': False,
        'mentions_strategy': False,
        'mentions_params': False,
        'has_json': False,
        'has_tool_tags': False,
    }
    if not response:
        return signals

    lower = response.lower()
    signals['mentions_tool_name'] = 'pathfinding_lambda' in lower
    signals['mentions_strategy'] = 'quickest' in lower or 'coins_first' in lower
    signals['mentions_params'] = 'game_map' in lower or 'start_pos' in lower
    signals['has_json'] = '{' in response and '}' in response
    signals['has_tool_tags'] = '<tool_call>' in lower or '[tool_call]' in lower
    return signals


def invoke_lambda(function_name: str, payload: dict) -> dict:
    """Invoke Lambda function and return response."""
    try:
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType='RequestResponse',
            Payload=json.dumps(payload)
        )
        return json.loads(response['Payload'].read().decode('utf-8'))
    except Exception as e:
        return {"error": str(e)}


def compare_lambda_outputs(predicted_output: dict, expected_output: dict) -> float:
    """Returns 1.0 for exact path match, 0.0 otherwise."""
    if predicted_output.get('statusCode') != expected_output.get('statusCode'):
        return 0.0
    try:
        pred_body = json.loads(predicted_output.get('body', '{}'))
        exp_body = json.loads(expected_output.get('body', '{}'))
    except:
        return 0.0
    return 1.0 if pred_body.get('path', []) == exp_body.get('path', []) else 0.0


def reward_function(sample: Dict[str, Any], index: int) -> Dict[str, Any]:
    """
    Reward function for tool-calling training.
    Parses tool calls from raw text and scores them against ground truth.
    """
    messages = sample.get('messages', sample.get('prompt', []))

    # Get assistant response text
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
            ground_truth = json.loads(ground_truth_str) if isinstance(ground_truth_str, str) else ground_truth_str
        except json.JSONDecodeError:
            ground_truth = {}

    expected_input = {}
    if 'function' in ground_truth:
        arguments = ground_truth['function'].get('arguments', '{}')
        if isinstance(arguments, str):
            try:
                expected_input = json.loads(arguments)
            except:
                expected_input = {}
        else:
            expected_input = arguments
    elif 'input' in ground_truth:
        expected_input = ground_truth['input']

    expected_output = ground_truth.get('output', {})

    # Try to extract structured tool call from text
    predicted = extract_tool_call(response)
    text_signals = extract_text_signals(response)
    response_len = len(response)

    # Scoring
    text_reward = 0.0
    tool_score = 0.0
    format_score = 0.0
    map_score = 0.0
    pos_score = 0.0
    strategy_score = 0.0
    param_score = 0.0
    lambda_success_score = 0.0
    output_match_score = 0.0
    lambda_output = None

    if not predicted:
        # No structured tool call — soft signals only
        if text_signals['has_tool_tags']:
            text_reward = 0.15
        else:
            if text_signals['mentions_tool_name']:
                text_reward += 0.03
            if text_signals['mentions_strategy']:
                text_reward += 0.02
            if text_signals['mentions_params']:
                text_reward += 0.02
            if text_signals['has_json']:
                text_reward += 0.03
            text_reward = min(text_reward, 0.10)
    else:
        format_score = 1.0
        tool_name = predicted.get('tool', '').lower()
        if tool_name in ['pathfinding_lambda', 'pathfinding']:
            tool_score = 1.0

        if tool_score > 0 and expected_input:
            pred_params = predicted.get('parameters', {})
            if pred_params.get('game_map') == expected_input.get('game_map'):
                map_score = 1.0
            if pred_params.get('start_pos') == expected_input.get('start_pos'):
                pos_score = 1.0
            pred_strategy = str(pred_params.get('strategy', '')).lower()
            exp_strategy = str(expected_input.get('strategy', '')).lower()
            if pred_strategy == exp_strategy:
                strategy_score = 1.0
            param_score = map_score * 0.5 + pos_score * 0.25 + strategy_score * 0.25

        # Lambda verification (only if params look good)
        if tool_score > 0 and param_score > 0.5:
            pred_params = predicted.get('parameters', {})
            try:
                lambda_output = invoke_lambda('AgentCoreGatewayTool-Pathfinding', pred_params)
                if 'error' not in lambda_output and lambda_output.get('statusCode') == 200:
                    lambda_success_score = 1.0
            except:
                lambda_success_score = 0.0

            if lambda_output and expected_output:
                output_match_score = compare_lambda_outputs(lambda_output, expected_output)

    # Aggregate reward
    if not predicted:
        aggregate_reward = text_reward
    elif tool_score == 0.0:
        aggregate_reward = 0.0
    else:
        aggregate_reward = (
            0.20 +
            param_score * 0.50 +
            format_score * 0.10 +
            lambda_success_score * 0.10 +
            output_match_score * 0.10
        )

    aggregate_reward = max(0.0, min(1.0, aggregate_reward))

    # Metrics
    metrics = [
        {'name': 'correct_tool', 'value': float(tool_score), 'type': 'Reward'},
        {'name': 'game_map_match', 'value': float(map_score), 'type': 'Reward'},
        {'name': 'start_pos_match', 'value': float(pos_score), 'type': 'Reward'},
        {'name': 'strategy_match', 'value': float(strategy_score), 'type': 'Reward'},
        {'name': 'format_valid', 'value': float(format_score), 'type': 'Metric'},
        {'name': 'lambda_success', 'value': float(lambda_success_score), 'type': 'Metric'},
        {'name': 'output_match', 'value': float(output_match_score), 'type': 'Metric'},
        {'name': 'text_reward', 'value': float(text_reward), 'type': 'Metric'},
        {'name': 'response_length', 'value': float(response_len), 'type': 'Metric'},
    ]

    sample_id = sample.get('id', sample.get('extra_info', {}).get('index', f'sample-{index:03d}'))

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