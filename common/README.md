# Common TypeScript code

This directory contains application policies and client behavior shared by
multiple TypeScript environments. `core` defines EBP identity, cryptographic,
and exchange formats; `common` may depend on `core`, but `core` must not depend
on `common`. Keep application-specific presentation and lookup policy here
when it is shared, rather than making it part of the protocol implementation.

Run `deno task test:core` to include the shared TypeScript regression tests.
