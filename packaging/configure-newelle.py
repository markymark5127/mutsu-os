#!/usr/bin/env python3
"""Run inside Newelle's Flatpak to configure its native Gio.Settings safely."""
import importlib
import json
from pathlib import Path
import platform
import shutil
import sys


def prepare_dependencies(bundle, target):
    metadata = json.loads((bundle / 'runtime.json').read_text(encoding='utf-8'))
    if metadata.get('python') != list(sys.version_info[:2]) or metadata.get('machine') != platform.machine():
        raise RuntimeError('Newelle runtime changed; a matching OS dependency bundle is required')
    shutil.copytree(bundle / 'packages', target, dirs_exist_ok=True)
    sys.path.insert(0, str(target))
    importlib.invalidate_caches()
    for name in ('fastapi', 'uvicorn', 'multipart', 'openai', 'ollama'):
        importlib.import_module(name)


def configure(settings, token, bundled_model=None):
    if not token or '\n' in token or '\r' in token:
        raise ValueError('The local Newelle token is invalid')
    if bundled_model and (bundled_model.get('endpoint') != 'http://127.0.0.1:11435' or
                          bundled_model.get('model') != 'qwen3.5:9b'):
        raise ValueError('The bundled model must use the packaged local Ollama endpoint')

    def read_json(key):
        value = json.loads(settings.get_string(key))
        if not isinstance(value, dict):
            raise ValueError(f'Invalid Newelle {key}')
        return value

    def write_json(key, value):
        if not settings.set_string(key, json.dumps(value, separators=(',', ':'))):
            raise RuntimeError(f'Could not save Newelle {key}')

    interfaces = read_json('interfaces-settings')
    gui = interfaces.get('gui-api', {})
    if not isinstance(gui, dict):
        gui = {}
    gui.update({'api_key': token, 'host': '127.0.0.1', 'port': 8081})
    interfaces['gui-api'] = gui
    write_json('interfaces-settings', interfaces)
    selected = settings.get_string('language-model')
    llm = read_json('llm-settings')
    ollama = llm.get('ollama', {})
    if not isinstance(ollama, dict):
        ollama = {}
    # Replace the online demo with the requested offline model. Keep other
    # chosen models, remote Ollama endpoints and cloud provider credentials.
    local_ollama = selected == 'ollama' and ollama.get('model', '') in ('', 'qwen3.5:9b') and \
        ollama.get('endpoint', '') in ('', 'http://localhost:11434', 'http://127.0.0.1:11434', 'http://127.0.0.1:11435')
    if bundled_model and (settings.get_user_value('language-model') is None or selected == 'newelle' or local_ollama):
        ollama.update({'endpoint': bundled_model['endpoint'], 'model': bundled_model['model'],
                       'models': json.dumps([[bundled_model['model'], bundled_model['model']]])})
        ollama.setdefault('thinking', False)
        llm['ollama'] = ollama
        write_json('llm-settings', llm)
        if not settings.set_string('language-model', 'ollama'):
            raise RuntimeError('Could not select the bundled local model')
        selected = 'ollama'
    return selected


if __name__ == '__main__':
    from gi.repository import Gio, GLib
    root = Path(sys.argv[1])
    prepare_dependencies(root / 'newelle-offline-bundle', Path(GLib.get_user_config_dir()) / 'pip')
    token = (root / 'newelle-token').read_text(encoding='utf-8').strip()
    descriptor = root / 'bundled-model.json'
    model = json.loads(descriptor.read_text(encoding='utf-8')) if descriptor.is_file() else None
    settings = Gio.Settings.new('io.github.qwersyk.Newelle')
    configure(settings, token, model)
    Gio.Settings.sync()
    print('Newelle local connection configured.')
