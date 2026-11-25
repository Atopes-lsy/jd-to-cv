"""Loopback-only desktop backend. No personal documents or API keys are persisted."""
import argparse
import contextlib
import json
import os
import re
import sqlite3
import sys
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROVIDERS = {'deepseek': 'https://api.deepseek.com/chat/completions', 'openai': 'https://api.openai.com/v1/chat/completions'}
EVENTS = {'extract_success', 'profile_extract_success', 'resume_success', 'print_opened', 'source_exported'}
RESOURCE_ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1])) / 'webapp'
SECURITY = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}


class AppError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def today():
    return datetime.now(timezone(timedelta(hours=8))).date().isoformat()


def validate(body, prompts):
    if not isinstance(body, dict) or body.get('operation') not in ('test', 'extract', 'profile', 'resume') or body.get('mode') not in ('sponsored', 'byok'):
        raise AppError('请求操作或使用方式不正确。')
    if any(not isinstance(body.get(k, ''), str) for k in ('text', 'profile', 'image')):
        raise AppError('输入字段格式错误。')
    text, profile, image = (body.get(k, '') for k in ('text', 'profile', 'image'))
    if len((text + profile + json.dumps(prompts, ensure_ascii=False)).encode('utf-8')) > 50000:
        raise AppError('文字资料过长，请精简后重试。')
    if body['operation'] in ('extract', 'profile') and not text.strip() and not image:
        raise AppError('请提供岗位截图或文字。')
    if body['operation'] == 'resume' and (not text.strip() or not profile.strip()):
        raise AppError('请先提供岗位和个人资料。')
    if image and (body['operation'] not in ('extract', 'profile') or len(image) > 2000000 or not re.fullmatch(r'data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+', image)):
        raise AppError('图片格式或大小不符合要求。')
    if body['mode'] == 'byok':
        if body.get('provider') not in PROVIDERS or not isinstance(body.get('key'), str) or not re.fullmatch(r'[\x21-\x7e]{8,512}', body['key']):
            raise AppError('服务商或 API Key 格式不正确。')
        if not isinstance(body.get('model'), str) or not re.fullmatch(r'[\w.\-:/]{1,100}', body['model'], flags=re.ASCII):
            raise AppError('模型名称格式不正确。')


def validate_result(result, operation):
    def strings(value, limit=40):
        return isinstance(value, list) and len(value) <= limit and all(isinstance(x, str) for x in value)
    if not isinstance(result, dict):
        raise AppError('模型返回格式不正确。', 502)
    if operation == 'profile':
        valid = isinstance(result.get('profile_text'), str) and bool(result['profile_text'].strip()) and strings(result.get('notes'))
    elif operation == 'extract':
        valid = all(isinstance(result.get(k), str) for k in ('company', 'title', 'location', 'direction', 'raw_text'))
        valid = valid and bool(result['raw_text'].strip()) and strings(result.get('tags'))
        reqs = result.get('requirements')
        valid = valid and isinstance(reqs, list) and len(reqs) <= 40 and all(isinstance(r, dict) and isinstance(r.get('text'), str) and isinstance(r.get('source_quote'), str) and r.get('type') in ('hard', 'preferred', 'responsibility') for r in reqs)
    else:
        valid = all(isinstance(result.get(k), str) for k in ('name', 'headline', 'contact'))
        valid = valid and all(strings(result.get(k)) for k in ('education', 'skills', 'notes'))
        projects = result.get('projects')
        valid = valid and isinstance(projects, list) and len(projects) <= 3 and all(isinstance(p, dict) and all(isinstance(p.get(k), str) for k in ('name', 'role', 'period', 'evidence')) and strings(p.get('bullets'), 4) for p in projects)
    if not valid:
        raise AppError('模型返回结构不完整，请精简资料后重试。', 502)
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def model_call(body, prompts, sponsored_key='', opener=None):
    validate(body, prompts)
    provider = 'deepseek' if body['mode'] == 'sponsored' else body['provider']
    key = sponsored_key if body['mode'] == 'sponsored' else body['key']
    if not key:
        raise AppError('平台内测尚未开启，可使用自己的 API Key。', 503)
    operation = body['operation']
    content = '只回复 OK。' if operation == 'test' else body.get('text') or '完整读取这张岗位截图。'
    if operation == 'resume':
        content = json.dumps({'jd': body['text'], 'personal_evidence': body['profile']}, ensure_ascii=False)
    if body.get('image'):
        content = [{'type': 'text', 'text': content}, {'type': 'image_url', 'image_url': {'url': body['image'], 'detail': 'high'}}]
    payload = {'model': 'deepseek-flash' if body['mode'] == 'sponsored' else body['model'],
               'messages': [{'role': 'system', 'content': '连接测试。' if operation == 'test' else prompts[operation]}, {'role': 'user', 'content': content}],
               'max_tokens': 8 if operation == 'test' else 4096}
    if provider == 'deepseek':
        payload['thinking'] = {'type': 'disabled'}
    if operation != 'test':
        payload['response_format'] = {'type': 'json_object'}
    request = urllib.request.Request(PROVIDERS[provider], data=json.dumps(payload).encode('utf-8'), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with (opener or urllib.request.build_opener(NoRedirect())).open(request, timeout=90) as response:
            raw = response.read(400001)
            if len(raw) > 400000:
                raise AppError('模型返回数据过大。', 502)
    except urllib.error.HTTPError as error:
        messages = {401: 'API Key 无效或已失效。', 402: '模型账户余额不足。', 403: '模型服务拒绝访问。', 429: '模型服务限流，请稍后重试。'}
        raise AppError(messages.get(error.code, '模型服务返回错误，请检查模型或视觉支持。'), 502) from None
    except (OSError, urllib.error.URLError):
        raise AppError('模型服务不可达或连接超时，请稍后重试。', 502) from None
    try:
        choice = json.loads(raw)['choices'][0]
        if choice.get('finish_reason') == 'length':
            raise AppError('模型输出被截断，请精简资料后重试。', 502)
        content = choice['message']['content']
        if operation == 'test':
            if not content:
                raise ValueError()
            return {'result': {'connected': True}}
        return {'result': validate_result(json.loads(content), operation)}
    except (KeyError, IndexError, TypeError, ValueError):
        raise AppError('模型返回数据无法解析，请重试。', 502) from None


class Store:
    def __init__(self, root):
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / 'pilot.sqlite3'
        with self.db() as db:
            db.executescript('CREATE TABLE IF NOT EXISTS daily_budget(day TEXT PRIMARY KEY,units INTEGER NOT NULL DEFAULT 0 CHECK(units<=20));'
                             'CREATE TABLE IF NOT EXISTS analytics(day TEXT,event TEXT,count INTEGER,PRIMARY KEY(day,event));'
                             'CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY,day TEXT,rating INTEGER,text TEXT);')

    @contextlib.contextmanager
    def db(self):
        connection = sqlite3.connect(self.path, timeout=15)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def reserve(self):
        with self.db() as db:
            db.execute('INSERT INTO daily_budget VALUES (?,0) ON CONFLICT(day) DO NOTHING', (today(),))
            row = db.execute('UPDATE daily_budget SET units=units+1 WHERE day=? AND units<20 RETURNING units', (today(),)).fetchone()
            if not row:
                raise AppError('今天的内测额度已用完，可次日再试或使用自己的 Key。', 429)
            return row[0]


def make_server(port=8765, data_root=None, sponsored_key=None, caller=model_call, fixture=False):
    root = data_root or Path.home() / '.jd-to-cv' / 'desktop'
    store = Store(root)
    prompts = json.loads((RESOURCE_ROOT / 'prompts.json').read_text(encoding='utf-8'))
    key = sponsored_key if sponsored_key is not None else os.environ.get('DEEPSEEK_API_KEY', '')
    slots = threading.BoundedSemaphore(3)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not record IPs, bodies, keys or provider error messages.

        def send(self, value, status=200, content_type='application/json; charset=utf-8'):
            data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            for name, header in SECURITY.items():
                self.send_header(name, header)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def valid_host(self):
            return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

        def do_GET(self):
            if not self.valid_host():
                return self.send({'error': '不支持的主机名。'}, 403)
            if self.path == '/api/config':
                return self.send({'sponsored': bool(key), 'daily_budget_yuan': 5, 'feedback': True, 'provider': 'DeepSeek Flash', 'desktop': True, 'test_fixture': fixture})
            static = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
            if self.path not in static:
                return self.send({'error': '未找到此资源。'}, 404)
            name, mime = static[self.path]
            self.send((RESOURCE_ROOT / 'public' / name).read_bytes(), content_type=mime)

        def do_POST(self):
            try:
                if not self.valid_host() or self.headers.get('Origin') != f'http://127.0.0.1:{self.server.server_port}':
                    raise AppError('请求来源不正确。', 403)
                if self.headers.get('Content-Type') != 'application/json':
                    raise AppError('仅接收 JSON 请求。', 415)
                try:
                    length = int(self.headers.get('Content-Length', '-1'))
                except ValueError:
                    raise AppError('请求长度无效。')
                if not 0 < length <= 2300000:
                    raise AppError('上传内容大小不符合要求。', 413)
                self.connection.settimeout(15)
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise AppError('请求不完整。')
                body = json.loads(raw)
                if not isinstance(body, dict):
                    raise AppError('请求格式错误。')
                if self.path == '/api/model':
                    validate(body, prompts)
                    if not slots.acquire(blocking=False):
                        raise AppError('正在处理较多请求，请稍后重试。', 429)
                    try:
                        if body['mode'] == 'sponsored':
                            if not key:
                                raise AppError('本机未配置平台 Key，可在模型设置中填写自己的 Key。', 503)
                            store.reserve()
                        return self.send(caller(body, prompts, key))
                    finally:
                        slots.release()
                if self.path == '/api/event':
                    if body.get('consent') is not True or body.get('event') not in EVENTS or set(body) - {'consent', 'event'}:
                        raise AppError('统计请求缺少授权或包含额外数据。')
                    with store.db() as db:
                        db.execute('INSERT INTO analytics VALUES (?,?,1) ON CONFLICT(day,event) DO UPDATE SET count=MIN(count+1,10000)', (today(), body['event']))
                    return self.send({'saved': True})
                if self.path == '/api/feedback':
                    rating, text = body.get('rating'), body.get('text')
                    if body.get('consent') is not True or type(rating) is not int or not 1 <= rating <= 5 or not isinstance(text, str) or len(text) > 1000 or set(body) - {'consent', 'rating', 'text'}:
                        raise AppError('请授权并提交有效评分，文字最多 1000 字。')
                    if re.search(r'\b(?:sk-|ghp_|gho_)[a-zA-Z0-9_-]{8,}', text):
                        raise AppError('反馈疑似包含密钥，请移除后再提交。')
                    with store.db() as db:
                        cursor = db.execute('INSERT INTO feedback(day,rating,text) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM feedback WHERE day=?)<100', (today(), rating, text, today()))
                        if not cursor.rowcount:
                            raise AppError('今日反馈已达上限。', 429)
                    return self.send({'saved': True})
                raise AppError('未找到此接口。', 404)
            except AppError as error:
                self.send({'error': str(error)}, error.status)
            except (ValueError, UnicodeDecodeError):
                self.send({'error': 'JSON 格式不正确。'}, 400)
            except Exception:
                self.send({'error': '服务暂时不可用，请稍后重试。'}, 500)

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = make_server(args.port)
    print(f'JD to CV: http://127.0.0.1:{server.server_port}', flush=True)
    server.serve_forever()
