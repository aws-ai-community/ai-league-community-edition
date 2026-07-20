import json
import traceback


def lambda_handler(event, context):
    """
    Code Calculator Lambda Tool

    Executes Python code sent by the sub-agent and returns the result.
    The sub-agent generates verbose Python code to perform calculations,
    and this tool runs it in a sandboxed exec() call.

    ---
    Tool: calculate
    Description: Executes Python code for mathematical calculations and returns the printed output.
    Parameters:
        code    (required) - Python code to execute. Must print() the final result.
    ---
    """
    try:
        if 'body' in event:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            body = event

        code = body.get('code', '')

        if not code:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'No code provided'})
            }

        # Capture stdout from the executed code
        import io
        import sys

        stdout_capture = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = stdout_capture

        # Execute in a restricted namespace
        exec_globals = {"__builtins__": __builtins__}
        exec_locals = {}

        try:
            exec(code, exec_globals, exec_locals)
        finally:
            sys.stdout = old_stdout

        output = stdout_capture.getvalue().strip()

        return {
            'statusCode': 200,
            'body': json.dumps({
                'result': output,
                'status': 'ok'
            })
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'traceback': traceback.format_exc()
            })
        }
