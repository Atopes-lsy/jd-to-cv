"""Synthetic browser QA only. Never calls a model or reads an API key."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from desktop.server import make_server


def fixture(body, prompts, unused_key):
    if body['operation'] == 'test':
        return {'result': {'connected': True}}
    if body['operation'] == 'profile':
        return {'result': {'profile_text': '【合成图片识别资料】测试同学\n示例大学，信息系统专业，本科在读。\n校园活动平台：参与 React 前端开发和接口联调。', 'notes': ['合成识别结果，不代表真实 OCR 效果。', '图片中的日期需要本人核实。']}}
    if body['operation'] == 'extract':
        return {'result': {'company': '合成测试公司', 'title': '前端开发实习', 'location': '测试城市', 'direction': '前端', 'raw_text': '【合成测试岗位】熟悉 React、JavaScript，了解 TypeScript 优先。每周至少三天。', 'tags': ['React', 'TypeScript'], 'requirements': [{'text': '熟悉 React、JavaScript', 'type': 'hard', 'source_quote': '熟悉 React、JavaScript'}, {'text': '了解 TypeScript 优先', 'type': 'preferred', 'source_quote': '了解 TypeScript 优先'}]}}
    return {'result': {'name': '测试同学', 'headline': '前端开发实习', 'contact': '联系方式由本人填写', 'education': ['示例大学 · 信息系统专业 · 本科在读'], 'skills': ['React、JavaScript、TypeScript；表单交互与接口联调'], 'projects': [{'name': '校园活动平台', 'role': '参与前端开发', 'period': '2026.06—2026.09', 'bullets': ['拆分活动列表、详情与报名表单组件，覆盖加载、空数据与错误状态。', '对照接口字段完成报名流程联调，整理问题记录并核对修复结果。'], 'evidence': '合成个人资料中的项目说明'}], 'notes': ['合成测试结果，不代表真实模型质量。', '请在真实使用时确认个人贡献和到岗安排。']}}


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1] / '.ai/evidence/fixture-data'
    server = make_server(8765, root, sponsored_key='synthetic-fixture-only', caller=fixture, fixture=True)
    print('Synthetic QA preview (no model calls): http://127.0.0.1:8765', flush=True)
    server.serve_forever()
