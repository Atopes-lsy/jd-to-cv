import concurrent.futures
import contextlib
import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from desktop.server import AppError, Store, make_server, model_call, validate_result


class DesktopTests(unittest.TestCase):
    def test_profile_schema_preserves_uncertainty(self):
        result = validate_result({'profile_text': '日期待核对', 'notes': ['不清晰']}, 'profile')
        self.assertEqual(['不清晰'], result['notes'])
        with self.assertRaises(AppError): validate_result({'profile_text': 'no notes'}, 'profile')

    def test_concurrent_budget_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory))
            def attempt(_):
                try: return store.reserve()
                except AppError: return None
            with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                results = list(pool.map(attempt, range(60)))
            self.assertEqual(20, sum(x is not None for x in results))
            with self.assertRaises(AppError): Store(Path(directory)).reserve()

    def test_provider_request_and_secret_redaction(self):
        body = {'mode': 'byok', 'provider': 'deepseek', 'key': 'synthetic-test-key', 'model': 'deepseek-flash', 'operation': 'test'}
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual('https://api.deepseek.com/chat/completions', request.full_url)
                data = json.loads(request.data); self.assertEqual(8, data['max_tokens'])
                self.assertEqual('disabled', data['thinking']['type'])
                return contextlib.closing(io.BytesIO(json.dumps({'choices': [{'message': {'content': 'OK'}}]}).encode()))
        self.assertTrue(model_call(body, {}, opener=Opener())['result']['connected'])
        class Failing:
            def open(inner, *args, **kwargs): raise urllib.error.HTTPError('', 401, body['key'], {}, io.BytesIO(body['key'].encode()))
        with self.assertRaises(AppError) as caught: model_call(body, {}, opener=Failing())
        self.assertNotIn(body['key'], str(caught.exception))

    def test_real_http_entry_static_origin_and_feedback(self):
        with tempfile.TemporaryDirectory() as directory:
            server = make_server(0, Path(directory), sponsored_key='')
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            origin = f'http://127.0.0.1:{server.server_port}'
            def post(path, body, site=origin):
                request = urllib.request.Request(origin + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Origin': site})
                try:
                    with urllib.request.urlopen(request) as response: return response.status, json.load(response)
                except urllib.error.HTTPError as error: return error.code, json.load(error)
            try:
                with urllib.request.urlopen(origin) as response: self.assertIn('拖入岗位截图', response.read().decode())
                self.assertEqual(403, post('/api/model', {}, 'https://evil.invalid')[0])
                self.assertEqual(503, post('/api/model', {'mode': 'sponsored', 'operation': 'test'})[0])
                self.assertEqual(400, post('/api/event', {'consent': False, 'event': 'resume_success'})[0])
                self.assertEqual(200, post('/api/event', {'consent': True, 'event': 'resume_success'})[0])
                self.assertEqual(200, post('/api/feedback', {'consent': True, 'rating': 4, 'text': '合成反馈'})[0])
            finally: server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
