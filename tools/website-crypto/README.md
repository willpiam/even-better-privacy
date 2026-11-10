# Website crypto bundle

The static website serves `website/vendor/crypto-deps.js`, built from the
exact package versions in this directory's lockfile. To regenerate it:

```sh
npm ci --prefix tools/website-crypto
npm run build:website-crypto
npm run check:website-crypto
```

Commit the generated JavaScript and license notices. The check command rebuilds
both files in memory and fails if they differ from the checked-in artifacts.
The website and TypeScript interoperability tests load that same bundle.
