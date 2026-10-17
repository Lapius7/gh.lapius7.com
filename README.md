# gh.lapius7.com

[日本語](README.ja.md)

A small dashboard for GitHub activity. A dependency-free Node.js server serves static pages and a cached JSON API built on the GitHub GraphQL API.

## Features

- Personal stats page (`/`) and organization page (`/org.html`)
- `GET /api/stats`, `GET /api/year`, `GET /api/org`: JSON, cached for 5 minutes
- No build step and no npm dependencies

## Requirements

- Node.js 18 or later
- A GitHub personal access token

## Setup

```sh
cp .env.example .env
# set GH_TOKEN in .env
node server.js
```

Open `http://localhost:8420`.

## Configuration

Set these in `.env` or as environment variables.

| Name | Default | Description |
|---|---|---|
| `GH_TOKEN` | (none) | GitHub personal access token |
| `GH_USER` | `Lapius7` | User whose stats are shown |
| `PORT` | `8420` | Listening port |

Never commit `.env`. It is listed in `.gitignore`.

## Structure

```
server.js   HTTP server, GraphQL queries, cache
public/     index.html, org.html, style.css, common.js
```
