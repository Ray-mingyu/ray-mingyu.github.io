#!/usr/bin/env python3
"""Export aggregate Codex token counts only; never export conversation content."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

FIELDS = ('input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens')

def collect(roots, tz):
    days = defaultdict(lambda: dict.fromkeys(FIELDS, 0))
    seen = set()
    skipped = 0
    files = sorted({p for root in roots if root.exists() for p in root.rglob('*.jsonl')})
    for path in files:
        previous = None
        try:
            with path.open(encoding='utf-8') as stream:
                for line in stream:
                    if '"token_count"' not in line:
                        continue
                    try:
                        event = json.loads(line)
                        payload = event.get('payload', {})
                        info = payload.get('info')
                        if payload.get('type') != 'token_count' or not info:
                            continue
                        total = info['total_token_usage']
                        current = {k: int(total.get(k, 0)) for k in FIELDS}
                        last = {k: int(info.get('last_token_usage', {}).get(k, 0)) for k in FIELDS}
                        stamp = event['timestamp']
                        day = datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(tz).date().isoformat()
                        # Repeated notifications do not represent additional consumption.
                        if previous is not None and current == previous:
                            continue
                        # A resumed/forked log may start with inherited totals. Only count its last request.
                        delta = last if previous is None or current['total_tokens'] < previous['total_tokens'] else {
                            k: max(0, current[k] - previous[k]) for k in FIELDS
                        }
                        previous = current
                        # Forks and archived copies can repeat the same historical events.
                        fingerprint = (stamp, *(current[k] for k in FIELDS), *(last[k] for k in FIELDS))
                        if fingerprint in seen:
                            continue
                        seen.add(fingerprint)
                        if delta['total_tokens'] > 0:
                            for key in FIELDS:
                                days[day][key] += delta[key]
                    except (ValueError, KeyError, TypeError, AttributeError):
                        skipped += 1
        except OSError:
            skipped += 1
    return [{'date': day, **values} for day, values in sorted(days.items())], skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-dir', type=Path, default=Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')))
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data/token-usage.json')
    args = parser.parse_args()
    rows, skipped = collect([args.codex_dir / 'sessions', args.codex_dir / 'archived_sessions'], ZoneInfo('Australia/Melbourne'))
    result = {'version': 1, 'source': 'local_codex_logs', 'timezone': 'Australia/Melbourne',
              'updated_at': datetime.now(timezone.utc).isoformat(),
              'coverage': 'available_local_records', 'skipped_records': skipped, 'days': rows}
    # Do not create a commit merely because a refresh ran with unchanged counts.
    if args.output.exists():
        try:
            old = json.loads(args.output.read_text(encoding='utf-8'))
            if all(old.get(key) == value for key, value in result.items() if key != 'updated_at'):
                print('No new token records; existing snapshot preserved.')
                return
        except (ValueError, OSError):
            pass
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f'Updated {len(rows)} recorded days. Only aggregate numbers exported; {skipped} unreadable records skipped.')

if __name__ == '__main__':
    main()
