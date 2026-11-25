import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/jd-to-cv/scripts/knowledge_base.py'
spec = importlib.util.spec_from_file_location('knowledge_base', SCRIPT)
kb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kb)


class KnowledgeBaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / '知识库 with spaces'
        self.db = kb.connect(self.root)
        self.input = self.base / '输入.json'

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def ingest(self, data, job_id=None):
        self.input.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        return kb.ingest(self.db, self.root, self.input, job_id)

    def cli(self, *args):
        result = subprocess.run([sys.executable, '-X', 'utf8', str(SCRIPT), '--root', str(self.root), *args],
                                capture_output=True, text=True, encoding='utf-8', check=True)
        return json.loads(result.stdout)

    def test_duplicate_ingestion_is_idempotent(self):
        data = {'raw_text': '前端 React', 'company': '虚构甲'}
        one = self.ingest(data)
        self.assertEqual(one, self.ingest(data))
        self.assertEqual(1, self.db.execute('SELECT COUNT(*) FROM revisions').fetchone()[0])

    def test_history_and_latest_search_are_distinct(self):
        one = self.ingest({'raw_text': '前端 React 三个月'})
        two = self.ingest({'raw_text': '前端 React 四个月'}, one['job_id'])
        self.assertEqual(one['job_id'], two['job_id'])
        self.assertNotEqual(one['revision_id'], two['revision_id'])
        self.assertEqual([], kb.search(self.db, '三个月', 20))
        self.assertEqual(1, len(kb.search(self.db, '前端 react', 20)))
        self.assertEqual(2, len(self.cli('show', one['job_id'])))

    def test_original_survives_source_removal(self):
        source = self.base / '原件.txt'
        source.write_bytes('原始岗位'.encode('utf-8'))
        self.ingest({'attachments': ['原件.txt']})
        source.unlink()
        archived = kb.search(self.db, '', 20)[0]['originals'][0]
        self.assertEqual('原始岗位', (self.root / archived['path']).read_text(encoding='utf-8'))

    def test_explicit_identity_and_no_fuzzy_merge(self):
        one = self.ingest({'company': '甲', 'title': '前端', 'raw_text': 'React'})
        two = self.ingest({'company': '甲', 'title': '前端', 'raw_text': 'Vue'})
        self.assertNotEqual(one['job_id'], two['job_id'])
        three = self.ingest({'job_key': 'verified-key', 'raw_text': 'a'})
        four = self.ingest({'job_key': 'verified-key', 'raw_text': 'b'})
        self.assertEqual(three['job_id'], four['job_id'])

    def test_invalid_input_cannot_spoof_metadata(self):
        for data in ({}, {'raw_text': 123}, {'raw_text': 'a', 'tags': [123]},
                     {'raw_text': 'a', 'job_key': ''}, {'raw_text': 'a', 'revision_id': 999}):
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.ingest(data)
        self.assertEqual(0, self.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0])

    def test_unknown_revision_does_not_archive_file(self):
        file = self.base / 'not-archived.txt'
        file.write_text('test', encoding='utf-8')
        with self.assertRaises(subprocess.CalledProcessError):
            self.cli('link', '--revision-id', '999', '--kind', 'feedback', '--file', str(file))
        self.assertFalse((self.root / 'blobs').exists())

    def test_artifact_link_is_idempotent_and_copied(self):
        one = self.ingest({'raw_text': 'React'})
        source = self.base / '简历.tex'
        source.write_text('source fixture', encoding='utf-8')
        args = ('link', '--revision-id', str(one['revision_id']), '--kind', 'resume-source', '--file', str(source))
        linked = self.cli(*args)
        self.cli(*args)
        source.unlink()
        history = self.cli('show', one['job_id'])
        self.assertEqual(1, len(history[0]['artifacts']))
        self.assertEqual('source fixture', (self.root / linked['path']).read_text(encoding='utf-8'))

    def test_stats_count_jobs_not_repeated_tags(self):
        one = self.ingest({'raw_text': 'a', 'tags': ['React', 'React']})
        self.ingest({'raw_text': 'b', 'tags': ['React']}, one['job_id'])
        self.ingest({'raw_text': 'c', 'tags': ['react']})
        stats = self.cli('stats')
        self.assertEqual(2, stats['jobs'])
        self.assertEqual(3, stats['revisions'])
        self.assertEqual(2, stats['tag_frequency']['react'])


if __name__ == '__main__':
    unittest.main()
