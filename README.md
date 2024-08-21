# Media Proxy for Misskey on Cloudflare Workers

## 事前準備

依存パッケージをインストール：

```sh
pnpm install --frozen-lockfile
```

次に：
- `node_modules/file-type/browser.js` の最後の `export` 文以外をコメントアウト
- `node_modules/content-disposition/index.js:22` をコメントアウトして 24 行目に `import { basename } from 'node:path'` を追記
- `node_modules/safe-buffer/index.js:3` をコメントアウトして下に `import * as buffer from 'node:buffer'` を追記

## プレビュー

ローカルでプレビュー：

```sh
echo 'ENV = "development"' >> .dev.vars
pnpm wrangler dev
```

## デプロイ

デプロイ：

```sh
pnpm wrangler deploy
```

## メモ

#### アバター画像へのリクエストが Workers に複数回リダイレクトされて、5xx エラーになるのを防ぐ

ダッシュボードの Environment Variables で

`AVATAR_REDIRECT_ENABLED` に `true`

`AVATAR_REDIRECT_HOST` に Misskey サーバーのホスト名（例：`misskey.tld`）を指定する。

デプロイ時に上書きされないよう、Encrypt して保存する。

#### エラー時にログを Cloud Logging に送信する

ダッシュボードの Environment Variables で

`CLOUD_LOGGING_ENABLED` に `true`

`CLOUD_LOGGING_CREDENTIAL_JSON` に Google Cloud のサービスアカウントの認証情報を指定する。

`CLOUD_LOGGING_LOGNAME` に値を設定すると、`logName` を変更できる。

デプロイ時に上書きされないよう、Encrypt して保存する。
