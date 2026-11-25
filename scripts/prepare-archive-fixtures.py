"""After qa-browser-recovery.js, prepare fictional archive-boundary fixtures."""
import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'output/playwright'
data = json.loads((root / 'browser-backup.json').read_text(encoding='utf-8'))
template = data['jobs'][0]['versions'][-1]
versions = []
for index in range(101):
    version = copy.deepcopy(template)
    version.update(image=None, title='101版本恢复测试', original_text='原始岗位输入，区别于识别后正文', location='测试地点', direction='前端', raw_text=f'历史版本 {index}', fingerprint=f'history-fixture-{index}')
    version['requirements'] = [{'text': '熟悉 React', 'type': 'hard', 'source_quote': '原始证据：熟悉 React'}]
    version['resume_html'] = '<h1>历史简历</h1><p>替换截图后应清空。</p>'
    versions.append(version)
(root / 'history-101.json').write_text(json.dumps({'format': 'jd-to-cv-v1', 'jobs': [{'id': 'history-fixture', 'versions': versions}]}, ensure_ascii=False), encoding='utf-8')
version = copy.deepcopy(versions[-1])
version['title'] = '101简历恢复测试'
version['resumes'] = [{'created_at': '2026-11-25T00:00:00Z', 'html': f'<h1>历史简历 {i}</h1>', 'draft': {'evidence': f'证据 {i}'}} for i in range(101)]
(root / 'resumes-101.json').write_text(json.dumps({'format': 'jd-to-cv-v1', 'jobs': [{'id': 'resume-history-fixture', 'versions': [version]}]}, ensure_ascii=False), encoding='utf-8')
(root / 'oversize-backup.json').write_bytes(b' ' * (30 * 1024 * 1024 + 1))
print('Prepared synthetic 101-revision, 101-resume and oversize backup fixtures.')
