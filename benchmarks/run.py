#!/usr/bin/env python3
"""Build, run, record and plot the TypeScript/C comparison. See README.md."""
import argparse
import ctypes
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)


def run(command, **kwargs):
    return subprocess.run(command, text=True, check=True, **kwargs)


def output(command):
    return run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.strip()


def cpu_name():
    try:
        for line in Path('/proc/cpuinfo').read_text().splitlines():
            if line.startswith('model name'):
                return line.split(':', 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or platform.machine()


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def linked_openssl_version():
    library = ctypes.CDLL(str(ROOT / 'c-core/libebp_core.so'))
    library.OpenSSL_version.argtypes = [ctypes.c_int]
    library.OpenSSL_version.restype = ctypes.c_char_p
    return library.OpenSSL_version(0).decode('utf-8')


def quartiles(values):
    values = sorted(values)
    def at(p):
        x = p * (len(values) - 1)
        lo = int(x)
        hi = min(lo + 1, len(values) - 1)
        return values[lo] + (values[hi] - values[lo]) * (x - lo)
    return at(.25), statistics.median(values), at(.75)


def plot(report, path):
    results = report['results']
    fig, (ax, ratio_ax) = plt.subplots(1, 2, figsize=(14.5, 6.5), gridspec_kw={'width_ratios': [1.45, 1]}, layout='constrained')
    fig.get_layout_engine().set(rect=(0, .10, 1, .90))
    colors = {'typescript': '#2165a0', 'c': '#df632e'}
    for i, result in enumerate(results):
        samples = result['samples']
        for lang, offset in [('typescript', -.15), ('c', .15)]:
            vals = [s[f'{lang}_ms'] for s in samples]
            lo, median, hi = quartiles(vals)
            ax.scatter(vals, [i + offset] * len(vals), s=12, color=colors[lang], alpha=.25)
            ax.plot([lo, hi], [i + offset] * 2, color=colors[lang], linewidth=3)
            ax.scatter([median], [i + offset], color=colors[lang], s=35, zorder=3,
                       label=('TypeScript' if lang == 'typescript' else 'C') if i == 0 else None)
        ratios = [s['typescript_ms'] / s['c_ms'] for s in samples]
        lo, median, hi = quartiles(ratios)
        ratio_ax.scatter(ratios, [i] * len(ratios), s=16, color='#4b5570', alpha=.28)
        ratio_ax.plot([lo, hi], [i, i], color='#4b5570', linewidth=3)
        ratio_ax.scatter([median], [i], color='#4b5570', s=36, zorder=3)
        ratio_ax.annotate(f'{median:.2f}×', (median, i), xytext=(7, 0), textcoords='offset points', va='center', fontsize=9)
    names = [r['name'] for r in results]
    ax.set_yticks(range(len(names)), names)
    ax.invert_yaxis()
    ratio_ax.set_yticks(range(len(names)), [''] * len(names))
    ratio_ax.set_ylim(ax.get_ylim())
    ax.set_xscale('log')
    ratio_ax.set_xscale('log')
    ratio_ax.margins(x=.18)
    ratio_ax.axvline(1, color='#8b8b8b', linewidth=1, linestyle='--')
    ax.set_xlabel('Milliseconds per operation (log scale)')
    ratio_ax.set_xlabel('TypeScript time / C time (log scale; >1 favors C)')
    ax.set_title('Operation time', loc='left', fontweight='bold')
    ratio_ax.set_title('Relative speed', loc='left', fontweight='bold')
    for a in (ax, ratio_ax):
        a.grid(axis='x', which='major', alpha=.18)
        a.spines[['top', 'right']].set_visible(False)
    ax.legend(frameon=False, loc='lower right')
    fig.suptitle('TypeScript vs C core: measured performance', fontsize=16, fontweight='bold', x=.02, ha='left')
    fig.text(.02, .015, f"{report['rounds']} paired rounds · 1 KiB message · dots: rounds · lines: interquartile range · markers: medians\n"
             f"{report['machine']['cpu']} · {report['machine']['platform']} · Deno {report['deno']['deno']}", fontsize=8, color='#555555')
    for ext in ('png', 'svg'):
        output_path = path.with_suffix('.' + ext)
        fig.savefig(output_path, dpi=180, bbox_inches='tight')
        if ext == 'svg':
            output_path.write_text('\n'.join(line.rstrip() for line in output_path.read_text().splitlines()) + '\n')
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='benchmarks/results/latest', help='Output path without extension')
    parser.add_argument('--rounds', type=int, default=10)
    parser.add_argument('--target-ms', type=int, default=150)
    args = parser.parse_args()
    prefix = Path(args.output).resolve()
    prefix.parent.mkdir(parents=True, exist_ok=True)
    print('Building C library:', flush=True)
    build = run(['make', '-B', '-C', 'c-core'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout
    print(build, flush=True)
    json_path = prefix.with_suffix('.json')
    harness_hash = sha256_file('benchmarks/compare.ts')
    run(['deno', 'run', '--check', '--allow-read', '--allow-write', '--allow-ffi', 'benchmarks/compare.ts', str(json_path), str(args.rounds), str(args.target_ms)])
    if sha256_file('benchmarks/compare.ts') != harness_hash:
        raise RuntimeError('Benchmark source changed during the run')
    report = json.loads(json_path.read_text())
    report['machine'] = {'cpu': cpu_name(), 'platform': platform.platform(), 'python': sys.version.split()[0],
                         'openssl_cli': output(['openssl', 'version']), 'linked_openssl': linked_openssl_version(),
                         'linked_libraries': output(['ldd', 'c-core/libebp_core.so'])}
    report['build'] = {'command_output': build.strip(), 'git_revision': output(['git', 'rev-parse', 'HEAD']),
                       'working_tree_status': output(['git', 'status', '--short']),
                       'cflags_env': os.environ.get('CFLAGS'), 'ldflags_env': os.environ.get('LDFLAGS'),
                       'benchmark_sha256': harness_hash, 'shared_library_sha256': sha256_file('c-core/libebp_core.so')}
    json_path.write_text(json.dumps(report, indent=2) + '\n')
    plot(report, prefix)
    print('\nMedian milliseconds per operation (ratio: TypeScript / C):')
    for result in report['results']:
        ts = statistics.median(s['typescript_ms'] for s in result['samples'])
        c = statistics.median(s['c_ms'] for s in result['samples'])
        speedup = statistics.median(s['typescript_ms'] / s['c_ms'] for s in result['samples'])
        print(f"{result['name']:<34} TypeScript {ts:>9.4f}  C {c:>9.4f}  {speedup:>7.2f}×")
    print(f'\nResults: {json_path}, {prefix.with_suffix(".png")}, {prefix.with_suffix(".svg")}')


if __name__ == '__main__':
    main()
