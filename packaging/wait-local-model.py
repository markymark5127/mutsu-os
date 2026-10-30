#!/usr/bin/env python3
"""Check bundled Ollama; generic inference is an explicit build-time test only."""
import argparse
import json
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener

MODEL = 'qwen3.5:9b'
DIGEST = '56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90'


def wait_ready(base, attempts=120, smoke=False):
    opener = build_opener(ProxyHandler({}))
    for attempt in range(attempts):
        try:
            with opener.open(base + '/api/tags', timeout=2) as response:
                models = json.load(response)
            if not any(item.get('name') == MODEL and
                       item.get('digest', '').removeprefix('sha256:') == DIGEST
                       for item in models.get('models', [])):
                raise ValueError('Bundled model is not available')
            break
        except (URLError, OSError, ValueError):
            if attempt + 1 == attempts:
                raise RuntimeError('Bundled Ollama model did not become ready')
            time.sleep(1)
    if smoke:
        request = Request(base + '/api/chat', data=json.dumps({
            'model': MODEL, 'messages': [{'role': 'user', 'content': 'Say READY.'}],
            'think': False, 'stream': False, 'keep_alive': 0,
            'options': {'num_ctx': 2048, 'num_predict': 12, 'num_thread': 2},
        }).encode(), headers={'Content-Type': 'application/json'})
        with opener.open(request, timeout=300) as response:
            reply = json.load(response)
        if not reply['message']['content'].strip():
            raise RuntimeError('Bundled model returned an empty build-test reply')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:11435')
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    wait_ready(args.url, smoke=args.smoke)
    print('Bundled Qwen 3.5 9B through Ollama is ready.')
