# gh.lapius7.com

[English](README.md)

GitHub の活動を表示する小さなダッシュボードです。依存パッケージのない Node.js サーバーが、静的ページと、GitHub GraphQL API をもとにしたキャッシュ付きの JSON API を配信します。

## 機能

- 個人の統計ページ(`/`)と Organization ページ(`/org.html`)
- `GET /api/stats`、`GET /api/year`、`GET /api/org`: JSON を返し、5分間キャッシュします
- ビルド不要で、npm の依存もありません

## 必要なもの

- Node.js 18 以上
- GitHub の個人用アクセストークン

## セットアップ

```sh
cp .env.example .env
# .env の GH_TOKEN を設定する
node server.js
```

`http://localhost:8420` を開きます。

## 設定

`.env` または環境変数で設定します。

| 名前 | 既定値 | 説明 |
|---|---|---|
| `GH_TOKEN` | なし | GitHub の個人用アクセストークン |
| `GH_USER` | `Lapius7` | 統計を表示するユーザー |
| `PORT` | `8420` | 待ち受けるポート |

`.env` はコミットしないでください。`.gitignore` に入れてあります。

## 構成

```
server.js   HTTP サーバー、GraphQL クエリ、キャッシュ
public/     index.html、org.html、style.css、common.js
```
