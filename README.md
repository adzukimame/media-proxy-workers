# Media Proxy for Misskey on Cloudflare Workers

## Usage
```sh
pnpm install --frozen-lockfile
```

Then
- comment out all contents other than last export statement of `node_modules/file-type/browser.js`
- comment out `node_modules/content-disposition/index.js:22` and add `import { basename } from 'node:path'` to line 24
- comment out `node_modules/safe-buffer/index.js:3` and add `import * as buffer from 'node:buffer'` below

Finally
```sh
cp wrangler.example.toml wrangler.toml
echo 'ENV = "development"' > .dev.vars # for testing local
pnpm wrangler dev    # for testing local
pnpm wrangler deploy # to deploy
```

## Notes
- Set `AVATAR_REDIRECT_ENABLED` variable to true and `AVATAR_REDIRECT_HOST` variable to your Misskey server's host name (like misskey.tld) to avoid requests are redirected and backs to Workers and results in 5xx error.
- Set `CLOUD_LOGGING_ENABLED` variable to true and `CLOUD_LOGGING_CREDENTIAL_JSON` secret variable to your preferred Google Cloud sevice account's credential to send errors to Cloud Logging. Log names could be modifed by setting `CLOUD_LOGGING_LOGNAME` variable. If `CLOUD_LOGGING_LOGNAME` is not set, log name will be `misskey-media-proxy`.
