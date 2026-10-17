// Minimal GitHub stats server: static files + /api/stats (GraphQL, cached). No dependencies.
const http = require('http');
const { renderOg } = require('./og');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const { GH_TOKEN, GH_USER = 'Lapius7', PORT = 8420 } = process.env;
const PUBLIC = path.join(__dirname, 'public');
const TTL = 5 * 60 * 1000;
const cache = new Map();

const QUERY = `
query($login:String!, $cf:DateTime!, $ct:DateTime!, $pf:DateTime!, $pt:DateTime!, $yf:DateTime!, $yt:DateTime!,
      $mCur:String!, $mPrev:String!, $qOpenPr:String!, $qReview:String!, $qIssue:String!) {
  user(login:$login) {
    login name avatarUrl url bio
    followers { totalCount } following { totalCount } gists { totalCount }
    gl: gists(first:12, privacy:PUBLIC, orderBy:{field:PUSHED_AT, direction:DESC}) {
      nodes { name description url pushedAt stargazerCount files(limit:5) { name size language { name color } } }
    }
    organizations(first:10) { nodes { login avatarUrl url } }
    pinnedItems(first:6, types:REPOSITORY) { nodes { ... on Repository { ...R } } }
    cur: contributionsCollection(from:$cf, to:$ct) { ...C }
    prev: contributionsCollection(from:$pf, to:$pt) { ...C }
    year: contributionsCollection(from:$yf, to:$yt) {
      totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount weekday } } }
    }
    recent: repositories(first:12, ownerAffiliations:OWNER, privacy:PUBLIC, orderBy:{field:PUSHED_AT, direction:DESC}) {
      nodes { ...R pushedAt owner { login } defaultBranchRef { target { ... on Commit { history(first:3) { nodes { messageHeadline committedDate url } } } } } }
    }
    all: repositories(first:100, ownerAffiliations:OWNER, isFork:false) {
      nodes { stargazerCount languages(first:8, orderBy:{field:SIZE, direction:DESC}) { edges { size node { name color } } } }
    }
  }
  curMerged: search(query:$mCur, type:ISSUE) { issueCount }
  prevMerged: search(query:$mPrev, type:ISSUE) { issueCount }
  openPrs: search(query:$qOpenPr, type:ISSUE, first:6) { issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } ... on Issue { title url createdAt repository { nameWithOwner } } } }
  reviewReq: search(query:$qReview, type:ISSUE, first:6) { issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } ... on Issue { title url createdAt repository { nameWithOwner } } } }
  openIssues: search(query:$qIssue, type:ISSUE, first:6) { issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } ... on Issue { title url createdAt repository { nameWithOwner } } } }
}
fragment R on Repository { name description url stargazerCount forkCount primaryLanguage { name color } }
fragment C on ContributionsCollection {
  contributionCalendar { totalContributions }
  totalPullRequestContributions totalPullRequestReviewContributions
  totalCommitContributions totalIssueContributions
  commitContributionsByRepository(maxRepositories:25) { repository { nameWithOwner } contributions { totalCount } }
  pullRequestContributionsByRepository(maxRepositories:25) { repository { nameWithOwner } contributions { totalCount } }
  pullRequestReviewContributionsByRepository(maxRepositories:25) { repository { nameWithOwner } contributions { totalCount } }
  issueContributionsByRepository(maxRepositories:25) { repository { nameWithOwner } contributions { totalCount } }
}`;

const iso = (d) => d.toISOString();
const ymd = (d) => d.toISOString().slice(0, 10);

function ranges(period, now) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (period === 'month') {
    return {
      cf: new Date(Date.UTC(y, m, 1)), ct: now,
      pf: new Date(Date.UTC(y, m - 1, 1)), pt: new Date(Date.UTC(y, m, 1) - 1000),
      label: 'last month',
    };
  }
  const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
  const mon = new Date(Date.UTC(y, m, now.getUTCDate() - dow));
  return {
    cf: mon, ct: now,
    pf: new Date(mon.getTime() - 7 * 864e5), pt: new Date(mon.getTime() - 1000),
    label: 'last week',
  };
}

// Streak that ignores empty weekend days (Sat/Sun).
function streaks(days, today) {
  let longest = 0, run = 0;
  for (const d of days) {
    const wk = new Date(d.date + 'T00:00:00Z').getUTCDay();
    const weekend = wk === 0 || wk === 6;
    if (d.count > 0) { run++; longest = Math.max(longest, run); }
    else if (!weekend) run = 0;
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    const wk = new Date(d.date + 'T00:00:00Z').getUTCDay();
    const weekend = wk === 0 || wk === 6;
    if (d.count > 0) current++;
    else if (weekend) continue;
    else if (d.date === today) continue; // today not over yet
    else break;
  }
  return { current, longest };
}

async function gql(query, variables, tries = 3) {
  try { return await gql1(query, variables); }
  catch (e) { if (tries <= 1) throw e; await new Promise((r) => setTimeout(r, 600)); return gql(query, variables, tries - 1); }
}
async function gql1(query, variables) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${GH_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'gh.lapius7.com' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors || j).slice(0, 300));
  return j.data;
}

const rest = async (p) => {
  const r = await fetch('https://api.github.com' + p, {
    headers: { Authorization: `bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gh.lapius7.com' },
  });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
};

const byRepo = (c) => {
  const out = {};
  const add = (list, key) => (list || []).forEach((x) => {
    const n = x.repository.nameWithOwner;
    (out[n] = out[n] || { commits: 0, prs: 0, reviews: 0, issues: 0 })[key] += x.contributions.totalCount;
  });
  add(c.commitContributionsByRepository, 'commits');
  add(c.pullRequestContributionsByRepository, 'prs');
  add(c.pullRequestReviewContributionsByRepository, 'reviews');
  add(c.issueContributionsByRepository, 'issues');
  return out;
};

const toDays = (cal) => cal.weeks.flatMap((w) => w.contributionDays)
  .map((d) => ({ date: d.date, count: d.contributionCount, weekday: d.weekday }));

function summarizeEvent(e) {
  const repo = e.repo.name, p = e.payload || {};
  switch (e.type) {
    case 'PushEvent': return { icon: 'commit', text: `Pushed ${p.size ?? p.commits?.length ?? 1} commit(s) to ${repo}`, detail: p.commits?.[p.commits.length - 1]?.message?.split('\n')[0], url: `https://github.com/${repo}` };
    case 'PullRequestEvent': return { icon: 'pr', text: `${p.action === 'closed' && p.pull_request?.merged ? 'Merged' : p.action} PR #${p.number} in ${repo}`, detail: p.pull_request?.title, url: p.pull_request?.html_url };
    case 'IssuesEvent': return { icon: 'issue', text: `${p.action} issue #${p.issue?.number} in ${repo}`, detail: p.issue?.title, url: p.issue?.html_url };
    case 'PullRequestReviewEvent': return { icon: 'review', text: `Reviewed PR #${p.pull_request?.number} in ${repo}`, detail: p.pull_request?.title, url: p.review?.html_url };
    case 'CreateEvent': return { icon: 'create', text: `Created ${p.ref_type}${p.ref ? ' ' + p.ref : ''} in ${repo}`, url: `https://github.com/${repo}` };
    case 'WatchEvent': return { icon: 'star', text: `Starred ${repo}`, url: `https://github.com/${repo}` };
    case 'ForkEvent': return { icon: 'create', text: `Forked ${repo}`, url: `https://github.com/${repo}` };
    default: return null;
  }
}

async function buildStats(period) {
  const now = new Date();
  const r = ranges(period, now);
  const yf = new Date(now.getTime() - 365 * 864e5);
  const merged = (a, b) => `author:${GH_USER} is:pr is:merged merged:${ymd(a)}..${ymd(b)}`;
  const data = await gql(QUERY, {
    login: GH_USER,
    cf: iso(r.cf), ct: iso(r.ct), pf: iso(r.pf), pt: iso(r.pt), yf: iso(yf), yt: iso(now),
    mCur: merged(r.cf, now), mPrev: merged(r.pf, r.pt),
    qOpenPr: `author:${GH_USER} is:pr is:open sort:updated-desc`,
    qReview: `review-requested:${GH_USER} is:pr is:open sort:updated-desc`,
    qIssue: `assignee:${GH_USER} is:issue is:open sort:updated-desc`,
  });
  const u = data.user;
  const days = toDays(u.year.contributionCalendar);

  const byMonth = {}, byWeekday = Array(7).fill(0);
  for (const d of days) {
    const key = d.date.slice(0, 7);
    byMonth[key] = (byMonth[key] || 0) + d.count;
    byWeekday[d.weekday] += d.count;
  }
  const [bestMonth, bestMonthCount] = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const bestWd = byWeekday.indexOf(Math.max(...byWeekday));
  const best = days.reduce((a, d) => (d.count > a.count ? d : a), { count: 0, date: '' });
  const active = days.filter((d) => d.count > 0).length;

  // language share (bytes) across owned non-fork repos
  const langs = {};
  let stars = 0;
  for (const rp of u.all.nodes) {
    stars += rp.stargazerCount;
    for (const e of rp.languages.edges) {
      const l = (langs[e.node.name] = langs[e.node.name] || { name: e.node.name, color: e.node.color, size: 0 });
      l.size += e.size;
    }
  }
  const langList = Object.values(langs).sort((a, b) => b.size - a.size);
  const langTotal = langList.reduce((s, l) => s + l.size, 0) || 1;
  const top = langList.slice(0, 7).map((l) => ({ name: l.name, color: l.color, pct: +(l.size / langTotal * 100).toFixed(1) }));
  const rest_ = langList.slice(7).reduce((s, l) => s + l.size, 0);
  if (rest_) top.push({ name: 'Other', color: '#6b6b6b', pct: +(rest_ / langTotal * 100).toFixed(1) });

  // recent events + Actions runs (best effort)
  const [events, runs] = await Promise.all([
    rest(`/users/${GH_USER}/events/public?per_page=50`).then((ev) => ev.map((e) => ({ ...summarizeEvent(e), at: e.created_at })).filter((e) => e.text && e.icon !== 'commit')).catch(() => []),
    Promise.all(u.recent.nodes.slice(0, 5).map((rp) =>
      rest(`/repos/${rp.owner.login}/${rp.name}/actions/runs?per_page=2`)
        .then((j) => j.workflow_runs.map((w) => ({ repo: rp.name, name: w.name, status: w.status, conclusion: w.conclusion, url: w.html_url, at: w.created_at })))
        .catch(() => []))).then((a) => a.flat().sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6)),
  ]);

  // pushes come from GraphQL (the public events feed lags by hours)
  const commits = u.recent.nodes.flatMap((rp) => ((rp.defaultBranchRef && rp.defaultBranchRef.target && rp.defaultBranchRef.target.history.nodes) || [])
    .map((n) => ({ icon: 'commit', text: `Pushed to ${rp.owner.login}/${rp.name}`, detail: n.messageHeadline, url: n.url, at: n.committedDate })));
  const feed = [...events, ...commits].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 12);

  const sum = (c) => ({
    contributions: c.contributionCalendar.totalContributions, prsOpened: c.totalPullRequestContributions,
    reviews: c.totalPullRequestReviewContributions,
  });
  const list = (s) => s.nodes.filter((n) => n.title).map((n) => ({ title: n.title, url: n.url, repo: n.repository.nameWithOwner, at: n.createdAt }));

  return {
    user: {
      login: u.login, name: u.name, avatar: u.avatarUrl, url: u.url, bio: u.bio,
      followers: u.followers.totalCount, following: u.following.totalCount, gists: u.gists.totalCount,
      stars, orgs: u.organizations.nodes,
    },
    period, compareLabel: r.label,
    cur: { ...sum(u.cur), prsMerged: data.curMerged.issueCount, byRepo: byRepo(u.cur) },
    prev: { ...sum(u.prev), prsMerged: data.prevMerged.issueCount, byRepo: byRepo(u.prev) },
    year: {
      total: u.year.contributionCalendar.totalContributions, days,
      types: { commits: u.year.totalCommitContributions, issues: u.year.totalIssueContributions, prs: u.year.totalPullRequestContributions, reviews: u.year.totalPullRequestReviewContributions },
    },
    streak: streaks(days, ymd(now)),
    bestMonth: { month: bestMonth, count: bestMonthCount },
    bestWeekday: { index: bestWd, count: byWeekday[bestWd] },
    byWeekday, byMonth,
    bestDay: best, avgPerActiveDay: active ? +(days.reduce((s, d) => s + d.count, 0) / active).toFixed(1) : 0,
    languages: top,
    pinned: u.pinnedItems.nodes,
    gists: u.gl.nodes.map((g) => ({
      id: g.name, url: g.url, description: g.description, pushedAt: g.pushedAt, stars: g.stargazerCount,
      files: g.files.map((f) => ({ name: f.name, lang: f.language && f.language.name, color: f.language && f.language.color })),
    })),
    repos: u.recent.nodes,
    open: { prs: { total: data.openPrs.issueCount, items: list(data.openPrs) }, reviews: { total: data.reviewReq.issueCount, items: list(data.reviewReq) }, issues: { total: data.openIssues.issueCount, items: list(data.openIssues) } },
    events: feed, runs,
    generatedAt: now.toISOString(),
  };
}

const yearCache = new Map();
async function getYear(y) {
  const hit = yearCache.get(y);
  if (hit && Date.now() - hit.t < 60 * TTL) return hit.v;
  const now = new Date();
  const from = new Date(Date.UTC(y, 0, 1));
  const to = y === now.getUTCFullYear() ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59));
  const d = await gql(`query($l:String!,$f:DateTime!,$t:DateTime!){user(login:$l){contributionsCollection(from:$f,to:$t){contributionCalendar{totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}`,
    { l: GH_USER, f: iso(from), t: iso(to) });
  const cal = d.user.contributionsCollection.contributionCalendar;
  const v = { year: y, total: cal.totalContributions, days: toDays(cal) };
  yearCache.set(y, { t: Date.now(), v });
  return v;
}

async function getStats(period) {
  const hit = cache.get(period);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = await buildStats(period);
  cache.set(period, { t: Date.now(), v });
  return v;
}


// ---- organizations ----
const orgCache = new Map();
let orgList = { t: 0, v: [], me: null };
async function getOrgNames() {
  if (Date.now() - orgList.t < 60 * TTL && orgList.v.length) return orgList.v;
  const d = await gql(`query($l:String!){user(login:$l){login avatarUrl organizations(first:30){nodes{login avatarUrl}}}}`, { l: GH_USER });
  orgList = { t: Date.now(), v: d.user.organizations.nodes, me: { login: d.user.login, avatarUrl: d.user.avatarUrl } };
  return orgList.v;
}

async function buildOrg(login) {
  const d = await gql(`query($o:String!,$pr:String!,$is:String!){
    organization(login:$o){ login name description avatarUrl url websiteUrl location createdAt
      membersWithRole{ totalCount }
      teams{ totalCount }
      pinnedItems(first:6, types:REPOSITORY){ nodes{ ... on Repository { ...R } } }
      repositories(first:50, privacy:PUBLIC, orderBy:{field:PUSHED_AT, direction:DESC}){ totalCount
        nodes{ ...R pushedAt isArchived isFork languages(first:6, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } } } }
    }
    openPrs: search(query:$pr, type:ISSUE){ issueCount }
    openIssues: search(query:$is, type:ISSUE){ issueCount }
  }
  fragment R on Repository { name description url stargazerCount forkCount primaryLanguage { name color } }`,
    { o: login, pr: `org:${login} is:pr is:open`, is: `org:${login} is:issue is:open` });
  const o = d.organization;
  const repos = o.repositories.nodes;
  const langs = {};
  let stars = 0, forks = 0;
  for (const rp of repos) {
    stars += rp.stargazerCount; forks += rp.forkCount;
    if (rp.isFork) continue;
    for (const e of rp.languages.edges) {
      const l = (langs[e.node.name] = langs[e.node.name] || { name: e.node.name, color: e.node.color, size: 0 });
      l.size += e.size;
    }
  }
  const ll = Object.values(langs).sort((a, b) => b.size - a.size);
  const tot = ll.reduce((s, l) => s + l.size, 0) || 1;
  const top = ll.slice(0, 7).map((l) => ({ name: l.name, color: l.color, pct: +(l.size / tot * 100).toFixed(1) }));
  const other = ll.slice(7).reduce((s, l) => s + l.size, 0);
  if (other) top.push({ name: 'Other', color: '#6b6b6b', pct: +(other / tot * 100).toFixed(1) });

  const [events, runs] = await Promise.all([
    rest(`/orgs/${o.login}/events?per_page=50`).then((ev) => ev.map((e) => ({ ...summarizeEvent(e), actor: e.actor.login, at: e.created_at })).filter((e) => e.text).slice(0, 12)).catch(() => []),
    Promise.all(repos.slice(0, 5).map((rp) =>
      rest(`/repos/${o.login}/${rp.name}/actions/runs?per_page=2`)
        .then((j) => j.workflow_runs.map((w) => ({ repo: rp.name, name: w.name, status: w.status, conclusion: w.conclusion, url: w.html_url, at: w.created_at })))
        .catch(() => []))).then((a) => a.flat().sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6)),
  ]);
  return {
    org: { login: o.login, name: o.name, description: o.description, avatar: o.avatarUrl, url: o.url, website: o.websiteUrl, location: o.location, createdAt: o.createdAt, members: o.membersWithRole.totalCount, teams: o.teams.totalCount },
    totals: { repos: o.repositories.totalCount, stars, forks, openPrs: d.openPrs.issueCount, openIssues: d.openIssues.issueCount },
    languages: top, pinned: o.pinnedItems.nodes, repos: repos.filter((r) => !r.isArchived).slice(0, 30),
    events, runs, generatedAt: new Date().toISOString(),
  };
}

async function getOrg(login) {
  const hit = orgCache.get(login);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = await buildOrg(login);
  orgCache.set(login, { t: Date.now(), v });
  return v;
}

let ogCache = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/stats') {
    const period = url.searchParams.get('period') === 'month' ? 'month' : 'week';
    try {
      const v = await getStats(period);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' });
      res.end(JSON.stringify(v));
    } catch (e) {
      console.error(e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream_error' }));
    }
    return;
  }
  if (url.pathname === '/og.png') {
    try {
      if (!ogCache || Date.now() - ogCache.t > TTL) ogCache = { t: Date.now(), v: renderOg(await getStats('week')) };
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' });
      return res.end(ogCache.v);
    } catch (e) { console.error(e.message); res.writeHead(502); return res.end(); }
  }
  if (url.pathname === '/api/year') {
    const y = +url.searchParams.get('y');
    if (!(y >= 2008 && y <= new Date().getUTCFullYear())) { res.writeHead(400); return res.end(); }
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
      return res.end(JSON.stringify(await getYear(y)));
    } catch (e) { console.error(e.message); res.writeHead(502); return res.end(); }
  }
  if (url.pathname === '/api/org') {
    try {
      const want = (url.searchParams.get('name') || '').toLowerCase();
      const login = (await getOrgNames()).find((n) => n.login.toLowerCase() === want)?.login;
      if (!login) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not_found"}'); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' });
      return res.end(JSON.stringify({ ...(await getOrg(login)), orgNames: await getOrgNames(), me: orgList.me }));
    } catch (e) { console.error(e.message); res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end('{"error":"upstream_error"}'); }
  }
  const seg = url.pathname.match(/^\/([A-Za-z0-9-]+)\/?$/);
  if (seg && !fs.existsSync(path.join(PUBLIC, seg[1]))) {
    try {
      if ((await getOrgNames()).some((n) => n.login.toLowerCase() === seg[1].toLowerCase())) {
        return fs.readFile(path.join(PUBLIC, 'org.html'), (err, buf) => { res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(buf); });
      }
    } catch (e) { console.error(e.message); }
  }
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`gh.lapius7.com on :${PORT}`));
