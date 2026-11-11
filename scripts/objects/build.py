"""Build the 3D object library from the Sand3D datasets on Hugging Face.

Runs in GitHub Actions (Hugging Face isn't reachable from everywhere):

    python -I scripts/objects/build.py --count 30 --out public/objects

1. Scan: reads only the metadata columns of all five datasets and writes a
   license report (every row, not a preview) to objects-summary.md.
2. Pick: chooses still-life objects by keyword, spread over the groups below,
   keeping only rows whose licenses we accept.
3. Convert: downloads each pick's USD file and turns it into a small gray GLB
   (usd_to_glb.py under Blender, then meshopt compression), plus a thumbnail
   from the dataset's render.
4. Writes <out>/index.json with license and credit for every object.

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

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem, hf_hub_download
from PIL import Image

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

# Still-life groups: label -> words matched against family and entry names.
GROUPS = {
    'cups and mugs': ['mug', 'cup', 'teacup', 'tumbler', 'goblet', 'glass'],
    'bottles and jars': ['bottle', 'jar', 'flask', 'jug', 'pitcher', 'carafe', 'decanter'],
    'bowls and plates': ['bowl', 'plate', 'dish', 'saucer', 'platter'],
    'vases and pots': ['vase', 'urn', 'planter', 'flowerpot', 'amphora'],
    'kettles and teapots': ['kettle', 'teapot', 'coffeepot', 'saucepan', 'pan', 'pot'],
    'lamps and candles': ['lamp', 'candle', 'candlestick', 'lantern'],
    'books and boxes': ['book', 'box', 'chest', 'crate', 'basket'],
    'fruit and food': ['apple', 'pear', 'banana', 'orange', 'lemon', 'fruit', 'bread', 'pumpkin', 'food'],
    'tools': ['hammer', 'wrench', 'pliers', 'scissors', 'screwdriver', 'saw', 'axe', 'tool'],
    'chairs and stools': ['chair', 'stool', 'bench'],
    'shoes and hats': ['shoe', 'boot', 'sneaker', 'hat', 'helmet'],
    'instruments': ['guitar', 'violin', 'trumpet', 'drum', 'metronome', 'horn'],
    'clocks and gadgets': ['clock', 'camera', 'telephone', 'phone', 'radio', 'lighter', 'globe'],
}

MIN_BYTES, MAX_BYTES = 8_000, 3_000_000  # skip near-empty and very heavy USD files
MAX_GLB = 1_000_000  # bytes, after compression


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


def group_of(r):
    w = words_of(r.get('family'), r.get('entry'))
    for label, keys in GROUPS.items():
        if w & set(keys):
            return label
    return None


def stable(r):
    return hashlib.sha256(str(r.get('id')).encode()).hexdigest()


def pick(rows, count):
    by_group = collections.defaultdict(list)
    for r in rows:
        if r['_repo'] not in PICK_FROM or not license_ok(r):
            continue
        size = r.get('usda_bytes') or 0
        if not (MIN_BYTES <= size <= MAX_BYTES):
            continue
        g = group_of(r)
        if g:
            by_group[g].append(r)
    for g in by_group:
        # Rigid objects first (joints are dropped anyway), then a stable shuffle.
        by_group[g].sort(key=lambda r: ((r.get('n_joints') or 0) > 0, stable(r)))
    # Round-robin over groups, alternating datasets, so the test set is varied.
    chosen, seen = [], set()
    pools = {g: list(v) for g, v in sorted(by_group.items())}
    while len(chosen) < count and any(pools.values()):
        for g, pool in pools.items():
            if not pool or len(chosen) >= count:
                continue
            used = {c['_repo'] for c in chosen if c['_group'] == g}
            i = next((k for k, r in enumerate(pool) if r['_repo'] not in used), 0)
            r = pool.pop(i)
            key = (norm(r.get('entry')) or norm(r.get('family')), g)
            if key in seen and len(pool) > 0:
                continue
            seen.add(key)
            r['_group'] = g
            chosen.append(r)
    return chosen, {g: len(v) for g, v in by_group.items()}


def first_url(text):
    m = re.search(r'https?://[^\s)\]>"\']+', text or '')
    return m.group(0).rstrip('.,;') if m else None


def title_of(r):
    m = re.search(r'["“]([^"”]{2,80})["”]', r.get('attribution') or '')
    if m:
        return m.group(1).strip()
    name = r.get('entry') or r.get('family') or 'Object'
    name = re.sub(r'[_\-]+', ' ', str(name)).strip()
    return name[:1].upper() + name[1:]


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
    info['rawBytes'] = os.path.getsize(raw)
    info['bytes'] = os.path.getsize(dst)
    return info


def summary(all_rows, chosen, pool_sizes, results, out):
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
    lines += ['', '## Still-life candidates per group', '', '| Group | Candidates |', '|---|---|']
    lines += [f'| {g} | {n} |' for g, n in sorted(pool_sizes.items())]
    lines += ['', '## Top families', '']
    fam = collections.Counter(f"{r['_repo'].replace('sand3d-', '')}: {r.get('family')}" for r in all_rows
                              if r['_repo'] in PICK_FROM and r.get('family'))
    lines += [f'- {k} ({n})' for k, n in fam.most_common(60)]
    lines += ['', '## Converted', '', '| Object | Group | Dataset | Parts | Triangles | USD | GLB | Note |',
              '|---|---|---|---|---|---|---|---|']
    for r in chosen:
        if r['id'] not in results:
            continue  # spare, not needed
        res = results[r['id']]
        glb = f"{res['bytes']/1e3:.0f} KB" if 'bytes' in res else ''
        lines.append(f"| {title_of(r)} | {r['_group']} | {r['_repo'].replace('sand3d-', '')} | "
                     f"{res.get('parts', '')} | {res.get('triangles', '')} | "
                     f"{(r.get('usda_bytes') or 0)/1e3:.0f} KB | {glb} | {res.get('note', '')} |")
    ok = [x for x in results.values() if 'bytes' in x and not x.get('note')]
    if ok:
        total = sum(x['bytes'] for x in ok)
        lines += ['', f'**{len(ok)} converted, {total/1e6:.2f} MB total, '
                  f'median {statistics.median(x["bytes"] for x in ok)/1e3:.0f} KB per object.**']
    with open(out, 'w') as f:
        f.write('\n'.join(lines) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', type=int, default=30)
    ap.add_argument('--out', default='public/objects')
    ap.add_argument('--summary', default='objects-summary.md')
    args = ap.parse_args()

    fs = HfFileSystem()
    all_rows = []
    for repo in DATASETS:
        rows = scan(fs, repo)
        print(f'{repo}: {len(rows)} rows', flush=True)
        all_rows += rows

    chosen, pool_sizes = pick(all_rows, int(args.count * 1.5))  # spares for failed conversions
    for r in chosen:
        r['_slug'] = slug(r)

    out = args.out
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, 'models'))
    os.makedirs(os.path.join(out, 'thumbs'))

    results, objects = {}, []
    with tempfile.TemporaryDirectory() as work:
        for r in chosen:
            if len(objects) >= args.count:
                break
            try:
                info = convert(r, out, work)
            except Exception as e:  # keep going; the report lists failures
                results[r['id']] = {'note': f'failed: {str(e).splitlines()[-1][:80] if str(e) else type(e).__name__}'}
                continue
            if info['bytes'] > MAX_GLB:
                os.remove(os.path.join(out, 'models', r['_slug'] + '.glb'))
                results[r['id']] = {**info, 'note': 'too big, skipped'}
                continue
            results[r['id']] = info
            objects.append(r)
    thumbnails(objects, out)

    index = {
        'version': 1,
        'source': 'Sand3D (Sandflow) on Hugging Face',
        'objects': [{
            'id': r['_slug'],
            'name': title_of(r),
            'group': r['_group'],
            'family': r.get('family') or '',
            'tags': sorted(w for w in words_of(r['_group'], r.get('family'), r.get('entry'))
                           if len(w) > 2 and w not in {'and', 'the', 'with', 'for'}),
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
    summary(all_rows, chosen, pool_sizes, results, args.summary)
    print(f'{len(objects)} objects written to {out}')


if __name__ == '__main__':
    main()
