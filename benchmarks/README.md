# TypeScript and C performance comparison

This benchmark compares the current core implementations on the same machine,
in the same Deno process, using a 1 KiB message and matching ML-DSA-87 and
ML-KEM-1024 identities. It covers SHA-256, the current Argon2id storage KDF,
message signing and verification, and complete one-recipient sign/encrypt and
decrypt/verify operations. Other profiles, message sizes, multi-recipient
operations, startup, identity creation and storage are not measured.

## Run it

On Linux, install the C core dependencies described in
[the Python README](../python/README.md), plus Deno, Python 3 and Matplotlib.
Run from the repository root:

```sh
python3 benchmarks/run.py --output benchmarks/results/my-machine
```

The runner rebuilds the C shared library using `make -B -C c-core`, runs the
benchmark, and writes `my-machine.json`, `my-machine.png`, and
`my-machine.svg`. Use `CFLAGS`, `CPPFLAGS` and `LDFLAGS` as usual to locate
nonstandard dependencies or change compiler settings. The defaults are 10
rounds and a 150 ms target batch duration; `--rounds` and `--target-ms` can
change them. An even number of rounds balances which implementation runs first.
Use a quiet machine and repeat the entire run when comparing changes.

Independent reports from matching environments and builds can be combined:

```sh
python3 benchmarks/combine.py --output benchmarks/results/combined \
  benchmarks/results/run1.json benchmarks/results/run2.json
```

The combined JSON retains each source run's metadata and batch sizes. Both
individual and combined graphs show all the recorded rounds.

## Method and interpretation

- Both implementations receive equivalent inputs and matching deterministic
  identities. The runner checks hashes and derived keys, verifies signatures
  across implementations, and decrypts messages produced by the other
  implementation before measuring anything.
- Keys, test inputs, fixtures, compilation and process startup are outside the
  timed sections. Each implementation gets initial calls and a full warmup
  batch. Each measured round uses one batch per implementation; their order
  alternates. Batch sizes are calibrated separately and capped to keep fast
  operations measurable. The report stores per-call time, call counts and all
  measured rounds.
- C is called through Deno FFI. For string APIs, the C side includes conversion
  between strings and bytes, output copying, freeing and the same base64 or hex
  representation used by the TypeScript API. This is an API-level measurement:
  TypeScript's identity routines may do work differently from C's routines,
  including public-key decoding and fingerprint handling. SHA-256 compares
  byte inputs and byte outputs. The benchmark measures C via Deno FFI, **not**
  Python bindings or native C callers; those have different overhead.
- The plot shows each round as a dot, the median as a larger dot, and the
  interquartile range as a line. Speed ratios are the median of the paired
  TypeScript-time / C-time ratios; greater than 1 favors C. They need not equal
  the ratio of the two displayed medians. Both axes use log scales.
- The JSON records the CPU, OS, Deno and Python versions, OpenSSL versions,
  linked library paths, Git revision, worktree status, build command and flags,
  and hashes of the benchmark source and built shared library. The `openssl`
  executable's version may differ from the linked library. The two example
  reports in this directory predate the linked-version and hash fields.

These are measurements on a specific machine and build, not guarantees or a
statistical confidence interval. Shared-machine load, CPU frequency, thermal
state, JIT compilation, allocation and other background activity can affect
results. Re-run before treating small differences as meaningful, and benchmark
real application workloads separately.
