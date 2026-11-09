#!/usr/bin/env python3
"""Combine comparable independent benchmark reports into one graph."""
import argparse
import copy
import json
import statistics
from pathlib import Path
from run import plot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='Output path without extension')
    parser.add_argument('reports', nargs='+', help='JSON reports produced by run.py')
    args = parser.parse_args()
    reports = [json.loads(Path(path).read_text()) for path in args.reports]
    first = reports[0]
    for report in reports[1:]:
        if (report['machine']['cpu'] != first['machine']['cpu'] or
            report['machine']['platform'] != first['machine']['platform'] or
            report['deno'] != first['deno'] or report['message_bytes'] != first['message_bytes'] or
            report['build']['git_revision'] != first['build']['git_revision'] or
            report['build']['command_output'] != first['build']['command_output'] or
            report['build'].get('benchmark_sha256') != first['build'].get('benchmark_sha256') or
            report['build'].get('shared_library_sha256') != first['build'].get('shared_library_sha256') or
            [r['name'] for r in report['results']] != [r['name'] for r in first['results']]):
            raise ValueError('Reports differ in environment, build, or operations; do not combine them')
    combined = copy.deepcopy(first)
    combined['rounds'] = sum(r['rounds'] for r in reports)
    combined['source_runs'] = [{**{k: v for k, v in report.items() if k != 'results'}, 'source': path}
                               for report, path in zip(reports, args.reports)]
    for i, result in enumerate(combined['results']):
        result['samples'] = [sample for report in reports for sample in report['results'][i]['samples']]
        result['iterations_per_run'] = [report['results'][i]['iterations_per_round'] for report in reports]
        del result['iterations_per_round']
    prefix = Path(args.output)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    prefix.with_suffix('.json').write_text(json.dumps(combined, indent=2) + '\n')
    plot(combined, prefix)
    for result in combined['results']:
        samples = result['samples']
        ts = statistics.median(s['typescript_ms'] for s in samples)
        c = statistics.median(s['c_ms'] for s in samples)
        ratio = statistics.median(s['typescript_ms'] / s['c_ms'] for s in samples)
        print(f"{result['name']:<34} TypeScript {ts:>9.4f} ms  C {c:>9.4f} ms  {ratio:>7.2f}×")
    print(f'Graph: {prefix.with_suffix(".png")}')


if __name__ == '__main__':
    main()
