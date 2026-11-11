"""Build the 3D object library from the Sand3D datasets on Hugging Face.

Runs in GitHub Actions (Hugging Face isn't reachable from everywhere):

    python -I scripts/objects/build.py --per-category 40 --out public/objects

1. Scan: reads only the metadata columns of all five datasets and writes a
   license report (every row, not a preview) to objects-summary.md.
2. Pick: sorts objects into the categories in categories.json by name,
   keeping only rows whose licenses we accept and that aren't listed in
   exclude.txt, and takes up to --per-category from each.
3. Convert: downloads each pick's USD file and turns it into a small gray GLB
   (usd_to_glb.py under Blender, then meshopt compression), plus a thumbnail
   from the dataset's render.
4. Writes <out>/index.json with license and credit for every object, and a
   contact sheet per category (numbered thumbnails) to --review for checking
   the picks by eye.

No Python from the datasets is executed: the USD files are imported as data.
"""
import argparse
import collections
import hashlib
import io
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem, hf_hub_download
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OWNER = 'Sandflow'
DATASETS = ['sand3d-simready', 'sand3d-objaverse', 'sand3d-articraft', 'sand3d-cad', 'sand3d-automate']
# Datasets that hold everyday objects worth drawing; CAD and AutoMate are
# machine parts, scanned for the report but not picked from yet.
PICK_FROM = ['sand3d-simready', 'sand3d-objaverse', 'sand3d-articraft']

META = ['id', 'asset_id', 'source', 'source_group', 'family', 'entry', 'license', 'source_license',
        'license_status', 'attribution', 'usda_path', 'usda_bytes', 'n_joints']

# Our rules: no NC or ND licenses. The datasets themselves are CC BY 4.0.
OK_LICENSE = {'cc-by-4.0'}
OK_SOURCE = {'cc-by-4.0', 'cc-by-3.0', 'cc0-1.0', 'cc0', 'apache-2.0', 'public-domain'}

LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'

CATEGORIES = json.load(open(os.path.join(HERE, 'categories.json')))['categories']
# Objects ruled out after looking at them (one id per line; "#" starts a
# comment). Use the object's id from index.json or its dataset asset_id.
EXCLUDE_FILE = os.path.join(HERE, 'exclude.txt')

MIN_BYTES, MAX_BYTES = 8_000, 3_000_000  # skip near-empty and very heavy USD files
MAX_GLB = 400_000  # bytes, after compression
MAX_TRIANGLES = 60_000
MAX_PARTS = 80  # many tiny parts usually means a messy model
SAME_NAME = 2  # at most this many objects with the same name per category
# Articraft models are mostly mechanisms (vises, gimbals, freezers); keep
# them to a few per category so everyday objects lead.
MAX_FROM = {'sand3d-articraft': 6}


def norm(s):
    return (s or '').strip().lower()


def words_of(*parts):
    text = ' '.join(str(p or '') for p in parts).lower()
    return set(re.split(r'[^a-z]+', text)) - {''}


def parquet_files(fs, repo):
    return sorted(fs.glob(f'datasets/{OWNER}/{repo}/data/**/*.parquet'))


def scan(fs, repo):
    rows = []
    for path in parquet_files(fs, repo):
        with fs.open(path, 'rb') as f:
            pf = pq.ParquetFile(f)
            cols = [c for c in META if c in pf.schema_arrow.names]
            table = pf.read(columns=cols)
        for r in table.to_pylist():
            r['_file'] = path
            r['_repo'] = repo
            rows.append(r)
    return rows


def license_ok(r):
    return (norm(r.get('license')) in OK_LICENSE
            and norm(r.get('source_license')) in OK_SOURCE
            and norm(r.get('license_status')) == 'ok')


def load_excluded():
    try:
        with open(EXCLUDE_FILE) as f:
            return {l.split('#')[0].strip() for l in f} - {''}
    except FileNotFoundError:
        return set()


def head_word(r):
    """The last word of the object's name: "Glass front display freezer" is
    a freezer, "Soap pump bottle" is a bottle."""
    words = re.findall(r'[a-z]+', title_of(r).lower())
    return words[-1] if words else ''


def category_of(r):
    head, names = head_word(r), words_of(title_of(r))
    family = norm(r.get('family'))
    for c in CATEGORIES:
        if r['_repo'] == 'sand3d-articraft' and not c.get('articraft', True):
            continue
        if head not in c['words'] or names & set(c.get('exclude', [])):
            continue
        if c.get('families') and r['_repo'] != 'sand3d-articraft' and family not in c['families']:
            continue
        return c
    return None


def stable(r):
    return hashlib.sha256(str(r.get('id')).encode()).hexdigest()


def candidates(rows, excluded):
    """Every usable object per category, in a stable, varied order."""
    by_cat = collections.defaultdict(list)
    for r in rows:
        if r['_repo'] not in PICK_FROM or not license_ok(r) or not r.get('entry'):
            continue
        if not (MIN_BYTES <= (r.get('usda_bytes') or 0) <= MAX_BYTES):
            continue
        r['_slug'] = slug(r)
        if {r['_slug'], str(r.get('asset_id')), str(r.get('id'))} & excluded:
            continue
        c = category_of(r)
        if c:
            r['_cat'] = c
            by_cat[c['id']].append(r)
    for cid, pool in by_cat.items():
        # Rigid objects first (joints are dropped anyway), then a stable
        # shuffle, then deal from each dataset in turn for variety.
        pool.sort(key=lambda r: ((r.get('n_joints') or 0) > 0, stable(r)))
        per_repo = collections.defaultdict(list)
        for r in pool:
            per_repo[r['_repo']].append(r)
        for repo, most in MAX_FROM.items():
            del per_repo[repo][most * 2:]  # twice the share, as spares
        dealt = []
        while any(per_repo.values()):
            for repo in sorted(per_repo):
                if per_repo[repo]:
                    dealt.append(per_repo[repo].pop(0))
        by_cat[cid] = dealt
    return by_cat


def first_url(text):
    m = re.search(r'https?://[^\s)\]>"\']+', text or '')
    return m.group(0).rstrip('.,;') if m else None


def title_of(r):
    # The program's entry name ("cathedral_radio") reads better than the
    # original upload titles, which are often file names or dates.
    name = r.get('entry') or ''
    if not name:
        m = re.search(r'["“]([^"”]{2,80})["”]', r.get('attribution') or '')
        name = m.group(1) if m else (r.get('family') or 'Object')
    name = re.sub(r'[_\-]+', ' ', str(name)).strip()
    name = re.sub(r'\b[a-z]\d{2}\b', '', name).strip()  # SimReady variant codes like "a01"
    return (name[:1].upper() + name[1:]) or 'Object'


def slug(r):
    base = re.sub(r'[^a-z0-9]+', '-', norm(r.get('entry') or r.get('family') or 'object')).strip('-')[:40]
    return f"{base or 'object'}-{stable(r)[:8]}"


def thumbnails(chosen, out_dir):
    by_file = collections.defaultdict(list)
    for r in chosen:
        by_file[r['_file']].append(r)
    fs = HfFileSystem()
    for path, rs in by_file.items():
        ids = [r['id'] for r in rs]
        with fs.open(path, 'rb') as f:
            pf = pq.ParquetFile(f)
            if 'render' not in pf.schema_arrow.names:
                continue
            # Read row group by row group so only matching renders are kept.
            for i in range(pf.num_row_groups):
                t = pf.read_row_group(i, columns=['id', 'render'])
                t = t.filter(pc.is_in(t['id'], value_set=pa.array(ids)))
                for row in t.to_pylist():
                    img = row['render']
                    data = img.get('bytes') if isinstance(img, dict) else img
                    if not data:
                        continue
                    r = next(x for x in rs if x['id'] == row['id'])
                    im = Image.open(io.BytesIO(data)).convert('RGB')
                    im.thumbnail((160, 160))
                    r['_image'] = im
                    name = f"{r['_slug']}.webp"
                    im.save(os.path.join(out_dir, 'thumbs', name), 'WEBP', quality=80)
                    r['_thumb'] = f'thumbs/{name}'


def convert(r, out_dir, work):
    src = hf_hub_download(f"{OWNER}/{r['_repo']}", r['usda_path'], repo_type='dataset', local_dir=work)
    raw = os.path.join(work, r['_slug'] + '.raw.glb')
    dst = os.path.join(out_dir, 'models', r['_slug'] + '.glb')
    res = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'usd_to_glb.py'), src, raw],
                         capture_output=True, text=True, timeout=300)
    if res.returncode != 0:
        raise RuntimeError((res.stderr or res.stdout)[-400:])
    info = json.loads([l for l in res.stdout.splitlines() if l.startswith('{')][-1])
    subprocess.run(['npx', '-y', '@gltf-transform/cli@4.5.1', 'optimize', raw, dst,
                    '--compress', 'meshopt', '--texture-compress', 'false',
                    '--simplify-error', '0.0005'],
                   check=True, capture_output=True, timeout=300)
    os.remove(raw)
    info['bytes'] = os.path.getsize(dst)
    if info['bytes'] > MAX_GLB:
        info['note'] = 'too big'
    elif info.get('triangles', 0) > MAX_TRIANGLES:
        info['note'] = 'too many triangles'
    elif info.get('parts', 0) > MAX_PARTS:
        info['note'] = 'too many parts'
    if info.get('note'):
        os.remove(dst)
    return info


def try_convert(r, out_dir, work):
    try:
        return convert(r, out_dir, work)
    except Exception as e:  # keep going; the report lists failures
        msg = str(e).strip().splitlines()[-1][:80] if str(e).strip() else type(e).__name__
        return {'note': f'failed: {msg}'}


def convert_categories(pools, per_category, out_dir, workers):
    """Convert objects category by category until each has per_category
    good ones (or runs out), never more than SAME_NAME with one name."""
    results, picked = {}, collections.defaultdict(list)
    queues = {cid: list(pool) for cid, pool in pools.items()}
    names = collections.defaultdict(collections.Counter)
    repos = collections.defaultdict(collections.Counter)
    with tempfile.TemporaryDirectory() as work, ThreadPoolExecutor(workers) as ex:
        while True:
            batch = []
            for cid, q in queues.items():
                want = per_category - len(picked[cid])
                if want <= 0:
                    continue
                want += max(2, want // 4)  # a few spares for failures
                while q and want:
                    r = q.pop(0)
                    name = title_of(r).lower()
                    if names[cid][name] >= SAME_NAME:
                        continue
                    if repos[cid][r['_repo']] >= MAX_FROM.get(r['_repo'], per_category):
                        continue
                    names[cid][name] += 1
                    repos[cid][r['_repo']] += 1
                    batch.append(r)
                    want -= 1
            if not batch:
                break
            print(f'converting {len(batch)} objects...', flush=True)
            for r, info in zip(batch, ex.map(lambda r: try_convert(r, out_dir, work), batch)):
                results[r['id']] = info
                cid = r['_cat']['id']
                if info.get('note'):
                    names[cid][title_of(r).lower()] -= 1
                    repos[cid][r['_repo']] -= 1
                elif len(picked[cid]) < per_category:
                    picked[cid].append(r)
                else:  # more than needed: a spare that wasn't used
                    repos[cid][r['_repo']] -= 1
                    os.remove(os.path.join(out_dir, 'models', r['_slug'] + '.glb'))
                    info['note'] = 'spare, not used'
    return results, picked


def contact_sheets(picked, review_dir):
    """One image per category: numbered thumbnails with names, plus a list
    of numbers and ids for adding bad picks to exclude.txt."""
    shutil.rmtree(review_dir, ignore_errors=True)
    os.makedirs(review_dir)
    font = ImageFont.load_default(size=13)
    cols, cell, label = 8, 168, 34  # 160 px thumbs with a gap
    for c in CATEGORIES:
        rs = picked.get(c['id'], [])
        if not rs:
            continue
        rows = -(-len(rs) // cols)
        sheet = Image.new('RGB', (cols * cell, rows * (cell + label)), 'white')
        draw = ImageDraw.Draw(sheet)
        lines = [f"# {c['label']} ({len(rs)})", '', '| # | Name | Id |', '|---|---|---|']
        for i, r in enumerate(rs):
            x, y = (i % cols) * cell, (i // cols) * (cell + label)
            im = r.get('_image')
            if im:
                sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
            draw.text((x + 4, y + cell + 2), f'{i + 1}. {title_of(r)}'[:24], fill='black', font=font)
            draw.text((x + 4, y + cell + 17), r['_repo'].replace('sand3d-', ''), fill='gray', font=font)
            lines.append(f"| {i + 1} | {title_of(r)} | {r['_slug']} |")
        sheet.save(os.path.join(review_dir, f"{c['id']}.webp"), 'WEBP', quality=82)
        with open(os.path.join(review_dir, f"{c['id']}.md"), 'w') as f:
            f.write('\n'.join(lines) + '\n')


def summary(all_rows, pools, picked, results, out):
    lines = ['# 3D object library build', '']
    lines += ['## License scan (every row)', '', '| Dataset | Rows | license | source_license | license_status | Accepted |',
              '|---|---|---|---|---|---|']
    for repo in DATASETS:
        rs = [r for r in all_rows if r['_repo'] == repo]
        c = lambda k: ', '.join(f'{v or "—"}: {n}' for v, n in collections.Counter(r.get(k) for r in rs).most_common(6))
        lines.append(f"| {repo} | {len(rs)} | {c('license')} | {c('source_license')} | {c('license_status')} | "
                     f"{sum(license_ok(r) for r in rs)} |")
    lines += ['', '## USD file sizes (accepted rows)', '', '| Dataset | Median | 90th pct | Under 3 MB |', '|---|---|---|---|']
    for repo in DATASETS:
        s = sorted(r.get('usda_bytes') or 0 for r in all_rows if r['_repo'] == repo and license_ok(r))
        if s:
            p90 = s[int(len(s) * 0.9) - 1] if len(s) > 1 else s[0]
            lines.append(f'| {repo} | {statistics.median(s)/1e3:.0f} KB | {p90/1e3:.0f} KB | '
                         f'{sum(x <= MAX_BYTES for x in s)} |')
    lines += ['', '## Categories', '', '| Category | Candidates | Picked |', '|---|---|---|']
    lines += [f"| {c['label']} | {len(pools.get(c['id'], []))} | {len(picked.get(c['id'], []))} |" for c in CATEGORIES]
    lines += ['', '## Top families', '']
    fam = collections.Counter(f"{r['_repo'].replace('sand3d-', '')}: {r.get('family')}" for r in all_rows
                              if r['_repo'] in PICK_FROM and r.get('family'))
    lines += [f'- {k} ({n})' for k, n in fam.most_common(60)]
    notes = collections.Counter(x['note'].split(':')[0] for x in results.values() if x.get('note'))
    lines += ['', '## Skipped while converting', '']
    lines += [f'- {k}: {n}' for k, n in notes.most_common()] or ['- none']
    failed = [x['note'] for x in results.values() if x.get('note', '').startswith('failed')]
    lines += [f'  - {n}' for n, _ in collections.Counter(failed).most_common(8)]
    ok = [x for x in results.values() if 'bytes' in x and not x.get('note')]
    if ok:
        total = sum(x['bytes'] for x in ok)
        lines += ['', f'**{len(ok)} converted, {total/1e6:.2f} MB total, '
                  f'median {statistics.median(x["bytes"] for x in ok)/1e3:.0f} KB per object.**']
    with open(out, 'w') as f:
        f.write('\n'.join(lines) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-category', type=int, default=40)
    ap.add_argument('--out', default='public/objects')
    ap.add_argument('--review', default='objects-review')
    ap.add_argument('--summary', default='objects-summary.md')
    ap.add_argument('--workers', type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()

    fs = HfFileSystem()
    all_rows = []
    for repo in DATASETS:
        rows = scan(fs, repo)
        print(f'{repo}: {len(rows)} rows', flush=True)
        all_rows += rows

    pools = candidates(all_rows, load_excluded())
    for c in CATEGORIES:
        print(f"{c['id']}: {len(pools.get(c['id'], []))} candidates", flush=True)

    out = args.out
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, 'models'))
    os.makedirs(os.path.join(out, 'thumbs'))

    results, picked = convert_categories(pools, args.per_category, out, args.workers)
    objects = [r for c in CATEGORIES for r in picked.get(c['id'], [])]
    thumbnails(objects, out)
    contact_sheets(picked, args.review)

    stop = {'and', 'the', 'with', 'for', 'old'}
    index = {
        'version': 1,
        'source': 'Sand3D (Sandflow) on Hugging Face',
        'objects': [{
            'id': r['_slug'],
            'name': title_of(r),
            'group': r['_cat']['chip'],
            'family': r.get('family') or '',
            'tags': sorted(w for w in words_of(r['_cat']['label'], r.get('family'), r.get('entry'))
                           if len(w) > 2 and w not in stop),
            'model': f"models/{r['_slug']}.glb",
            'thumb': r.get('_thumb'),
            'triangles': results[r['id']]['triangles'],
            'bytes': results[r['id']]['bytes'],
            'license': {'code': 'cc-by-4.0', 'name': 'CC BY 4.0', 'url': LICENSE_URL},
            'sourceLicense': r.get('source_license'),
            'credit': r.get('attribution') or '',
            'sourceUrl': first_url(r.get('attribution')),
            'dataset': f"https://huggingface.co/datasets/{OWNER}/{r['_repo']}",
            'assetId': r.get('asset_id') or r.get('id'),
        } for r in objects],
    }
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)
    summary(all_rows, pools, picked, results, args.summary)
    print(f'{len(objects)} objects written to {out}')


if __name__ == '__main__':
    main()
