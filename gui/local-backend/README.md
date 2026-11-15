# Local backend

`routes.ts` applies security checks, static serving, CORS, and error translation.
It dispatches to domain modules that return a response for a matching route or
`null` when the request belongs to another domain. Shared pure helpers and managed
mail configuration live in `route-support.ts`.

For an existing identity, use `mutateIdentityForRequest` for the entire load,
change, and save operation. This includes temporary signed details used for
payment proofs: deleting the temporary detail still changes the identity nonce.
Direct saves are reserved for creating a new identity. Cached storage keys avoid
repeating key-pair self-tests for unchanged private material, but every load
still decrypts and authenticates the current public snapshot.
