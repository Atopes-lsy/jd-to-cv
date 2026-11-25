"""Local JD archive. Standard library only; no network or model calls."""
import argparse
import hashlib
import json
import shutil
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def connect(root):
    root.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(root / 'knowledge.sqlite3', timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions (
            id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
            fingerprint TEXT NOT NULL, captured_at TEXT NOT NULL,
            payload TEXT NOT NULL, UNIQUE(job_id, fingerprint));
        CREATE TABLE IF NOT EXISTS artifacts (
            id INTEGER PRIMARY KEY, revision_id INTEGER NOT NULL REFERENCES revisions(id),
            kind TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL,
            created_at TEXT NOT NULL, UNIQUE(revision_id, kind, path));
    ''')
    return db


def stamp():
    return datetime.now(timezone.utc).isoformat()


def store_blob(root, source):
    source = Path(source).expanduser().resolve(strict=True)
    data_hash = digest(source.read_bytes())
    # Extension is cosmetic; SHA256 identifies the stored original bytes.
    target = root / 'blobs' / (data_hash + source.suffix.lower())
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        shutil.copyfile(source, target)
    elif digest(target.read_bytes()) != data_hash:
        raise ValueError('Stored blob failed hash verification: ' + str(target))
    return str(target.relative_to(root)), data_hash


def ingest(db, root, input_path, job_id):
    input_path = Path(input_path).resolve(strict=True)
    payload = json.loads(input_path.read_text(encoding='utf-8-sig'))
    if not isinstance(payload, dict):
        raise ValueError('Input must be a JSON object')
    for key in ('company', 'title', 'source_url', 'raw_text', 'location', 'direction'):
        if key in payload and not isinstance(payload[key], str):
            raise ValueError(key + ' must be a string')
    for key in ('requirements', 'tags', 'matches', 'gaps'):
        if key in payload and not isinstance(payload[key], list):
            raise ValueError(key + ' must be an array')
    if not all(isinstance(tag, str) for tag in payload.get('tags', [])):
        raise ValueError('tags must contain strings')
    if 'job_key' in payload and (not isinstance(payload['job_key'], str) or not payload['job_key'].strip()):
        raise ValueError('job_key must be a nonempty string')
    if any(key in payload for key in ('job_id', 'revision_id', 'captured_at', 'originals', 'artifacts')):
        raise ValueError('Input contains reserved archive metadata fields')
    attachments = payload.pop('attachments', [])
    if not isinstance(attachments, list) or not all(isinstance(x, str) for x in attachments):
        raise ValueError('attachments must be an array of paths')
    if not payload.get('raw_text', '').strip() and not attachments:
        raise ValueError('Provide original JD raw_text or an original attachment')
    originals = []
    for item in attachments:
        source = Path(item)
        if not source.is_absolute():
            source = input_path.parent / source
        path, sha = store_blob(root, source)
        originals.append({'name': source.name, 'path': path, 'sha256': sha})
    payload['originals'] = originals
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    fingerprint = digest(encoded.encode('utf-8'))
    if job_id:
        row = db.execute('SELECT identity FROM jobs WHERE id=?', (job_id,)).fetchone()
        if row is None:
            raise ValueError('Unknown job ID')
        identity = row['identity']
    else:
        # A share URL may contain tracking or may not uniquely identify a job.
        # Use an explicit verified key for cross-source merging; never fuzzy merge.
        identity = payload.get('job_key') or ('content:' + fingerprint)
        if not isinstance(identity, str) or not identity.strip():
            raise ValueError('job_key must be a nonempty string')
        job_id = 'jd-' + digest(identity.encode('utf-8'))[:20]
    with db:
        db.execute('INSERT OR IGNORE INTO jobs VALUES (?, ?, ?)', (job_id, identity, stamp()))
        db.execute('INSERT OR IGNORE INTO revisions(job_id,fingerprint,captured_at,payload) '
                   'VALUES (?,?,?,?)', (job_id, fingerprint, stamp(), encoded))
    row = db.execute('SELECT id,captured_at FROM revisions WHERE job_id=? AND fingerprint=?',
                     (job_id, fingerprint)).fetchone()
    return {'job_id': job_id, 'revision_id': row['id'], 'captured_at': row['captured_at']}


def revision_data(row):
    return {**json.loads(row['payload']), 'job_id': row['job_id'],
            'revision_id': row['id'], 'captured_at': row['captured_at']}


def search(db, query, limit):
    # Substring retrieval supports Chinese without an external word segmenter.
    # Search latest revisions only; historical payloads remain available via show.
    rows = db.execute('SELECT r.* FROM revisions r JOIN '
                      '(SELECT job_id,MAX(id) id FROM revisions GROUP BY job_id) latest '
                      'ON latest.id=r.id ORDER BY r.id DESC').fetchall()
    terms = query.casefold().split()
    found = []
    for row in rows:
        payload = json.loads(row['payload'])
        haystack = json.dumps(payload, ensure_ascii=False).casefold()
        if all(term in haystack for term in terms):
            found.append(revision_data(row))
            if limit and len(found) >= limit:
                break
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, help='Knowledge base data directory')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('init')
    p = sub.add_parser('ingest')
    p.add_argument('--input', required=True, help='UTF-8 JSON record')
    p.add_argument('--job-id', help='Add a revision to this existing job')
    p = sub.add_parser('search')
    p.add_argument('query', nargs='?', default='')
    p.add_argument('--limit', type=int, default=20)
    p = sub.add_parser('show')
    p.add_argument('job_id')
    p = sub.add_parser('link')
    p.add_argument('--revision-id', type=int, required=True)
    p.add_argument('--file', required=True)
    p.add_argument('--kind', choices=['resume-pdf', 'resume-source', 'match-report', 'feedback'], required=True)
    sub.add_parser('stats')
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    db = connect(root)
    try:
        if args.command == 'init':
            result = {'root': str(root), 'database': str(root / 'knowledge.sqlite3')}
        elif args.command == 'ingest':
            result = ingest(db, root, args.input, args.job_id)
        elif args.command == 'search':
            if args.limit < 1:
                raise ValueError('limit must be positive')
            result = search(db, args.query, args.limit)
        elif args.command == 'show':
            result = []
            for row in db.execute('SELECT * FROM revisions WHERE job_id=? ORDER BY id', (args.job_id,)):
                record = revision_data(row)
                record['artifacts'] = [dict(x) for x in db.execute(
                    'SELECT kind,path,sha256,created_at FROM artifacts WHERE revision_id=?', (row['id'],))]
                result.append(record)
            if not result:
                raise ValueError('Unknown job ID')
        elif args.command == 'link':
            if not db.execute('SELECT 1 FROM revisions WHERE id=?', (args.revision_id,)).fetchone():
                raise ValueError('Unknown revision ID')
            path, sha = store_blob(root, args.file)
            with db:
                db.execute('INSERT OR IGNORE INTO artifacts(revision_id,kind,path,sha256,created_at) '
                           'VALUES (?,?,?,?,?)', (args.revision_id, args.kind, path, sha, stamp()))
            result = {'revision_id': args.revision_id, 'kind': args.kind, 'path': path, 'sha256': sha}
        else:
            records = search(db, '', 0)
            counts = Counter()
            for record in records:
                counts.update(set(t.casefold().strip() for t in record.get('tags', [])
                                  if isinstance(t, str) and t.strip()))
            result = {'jobs': len(records), 'revisions': db.execute('SELECT COUNT(*) FROM revisions').fetchone()[0],
                      'tag_frequency': dict(counts.most_common()),
                      'scope': 'Latest revision per archived job; counts reflect supplied tags only, not the whole job market.'}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        db.close()


if __name__ == '__main__':
    main()
