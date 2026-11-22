// Minimal GitHub stats server: static files + /api/stats (GraphQL, cached). No dependencies.
const http = require('http');
const { renderOg, renderCard } = require('./og');
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
const { cached } = require('./cache');
const PUBLIC = path.join(__dirname, 'public');
const TTL = 5 * 60 * 1000;

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
    allRepos: repositories(first:100, ownerAffiliations:OWNER, privacy:PUBLIC, orderBy:{field:PUSHED_AT, direction:DESC}) {
      nodes { ...R pushedAt }
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
  openPrs: search(query:$qOpenPr, type:ISSUE, first:100) { issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } ... on Issue { title url createdAt repository { nameWithOwner } } } }
  reviewReq: search(query:$qReview, type:ISSUE, first:100) { issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } ... on Issue { title url createdAt repository { nameWithOwner } } } }
  openIssues: search(query:$qIssue, type:ISSUE, first:100) { issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } ... on Issue { title url createdAt repository { nameWithOwner } } } }
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

const PERIODS = ['today', 'week', 'month', 'd30', 'quarter', 'year'];
function ranges(period, now) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  const U = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd));
  const prev = (cf, pf, label) => ({ cf, ct: now, pf, pt: new Date(cf.getTime() - 1000), label });
  switch (period) {
    case 'today': { const t = U(y, m, d); return prev(t, U(y, m, d - 1), 'yesterday'); }
    case 'month': return prev(U(y, m, 1), U(y, m - 1, 1), 'last month');
    case 'd30': { const t = U(y, m, d); return prev(U(y, m, d - 29), U(y, m, d - 59), 'prev 30 days'); }
    case 'quarter': { const q = Math.floor(m / 3) * 3; return prev(U(y, q, 1), U(y, q - 3, 1), 'last quarter'); }
    case 'year': return prev(U(y, 0, 1), U(y - 1, 0, 1), 'last year');
    default: { const dow = (now.getUTCDay() + 6) % 7; const mon = U(y, m, d - dow); return prev(mon, new Date(mon.getTime() - 7 * 864e5), 'last week'); }
  }
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

const rest = async (p, accept = 'application/vnd.github+json') => {
  const r = await fetch('https://api.github.com' + p, {
    headers: { Authorization: `bearer ${GH_TOKEN}`, Accept: accept, 'User-Agent': 'gh.lapius7.com' },
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
    repos: u.allRepos.nodes,
    open: { prs: { total: data.openPrs.issueCount, items: list(data.openPrs) }, reviews: { total: data.reviewReq.issueCount, items: list(data.reviewReq) }, issues: { total: data.openIssues.issueCount, items: list(data.openIssues) } },
    events: feed, runs,
    generatedAt: now.toISOString(),
  };
}

// A past year no longer changes once GitHub has settled it (a few days after Dec 31): kept forever.
const yearFinal = (v) => Date.now() > Date.UTC(v.year + 1, 0, 8);
const getYear = (y) => cached('year:' + y, 60 * TTL, () => buildYear(y), yearFinal);
async function buildYear(y) {
  const now = new Date();
  const from = new Date(Date.UTC(y, 0, 1));
  const to = y === now.getUTCFullYear() ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59));
  const d = await gql(`query($l:String!,$f:DateTime!,$t:DateTime!){user(login:$l){contributionsCollection(from:$f,to:$t){contributionCalendar{totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}`,
    { l: GH_USER, f: iso(from), t: iso(to) });
  const cal = d.user.contributionsCollection.contributionCalendar;
  const v = { year: y, total: cal.totalContributions, days: toDays(cal) };
  return v;
}

const getStats = (period) => cached('stats:' + period, TTL, () => buildStats(period));


// ---- organizations ----
let orgList = { v: [], me: null };
async function getOrgNames() {
  orgList = await cached('orgs', 60 * TTL, async () => {
    const d = await gql(`query($l:String!){user(login:$l){login avatarUrl organizations(first:30){nodes{login avatarUrl}}}}`, { l: GH_USER });
  return { v: d.user.organizations.nodes, me: { login: d.user.login, avatarUrl: d.user.avatarUrl } };
  });
  return orgList.v;
}

const openList = (x) => x.nodes.filter((n) => n.title).map((n) => ({ title: n.title, url: n.url, repo: n.repository.nameWithOwner, at: n.createdAt }));

async function buildOrg(login) {
  const d = await gql(`query($o:String!,$pr:String!,$is:String!){
    organization(login:$o){ login name description avatarUrl url websiteUrl location createdAt
      membersWithRole{ totalCount }
      teams{ totalCount }
      pinnedItems(first:6, types:REPOSITORY){ nodes{ ... on Repository { ...R } } }
      repositories(first:50, privacy:PUBLIC, orderBy:{field:PUSHED_AT, direction:DESC}){ totalCount
        nodes{ ...R pushedAt isArchived isFork languages(first:6, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } } } }
    }
    openPrs: search(query:$pr, type:ISSUE, first:100){ issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } ... on Issue { title url createdAt repository { nameWithOwner } } } }
    openIssues: search(query:$is, type:ISSUE, first:100){ issueCount nodes { ... on PullRequest { title url createdAt repository { nameWithOwner } } ... on Issue { title url createdAt repository { nameWithOwner } } } }
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
    open: { prs: { total: d.openPrs.issueCount, items: openList(d.openPrs) }, issues: { total: d.openIssues.issueCount, items: openList(d.openIssues) } },
    languages: top, pinned: o.pinnedItems.nodes, repos: repos.filter((r) => !r.isArchived).slice(0, 30),
    events, runs, generatedAt: new Date().toISOString(),
  };
}

const ORG_TTL = 3 * TTL;
async function ghHtml(p) {
  const r = await fetch('https://api.github.com' + p, { headers: { Authorization: `bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.html+json', 'User-Agent': 'gh.lapius7.com' } });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.text();
}
// GitHub が整形済みの README HTML を返す。念のため script/イベント属性を除き、相対リンクを絶対化する
function fixReadme(h, owner, name, br) {
  const raw = `https://raw.githubusercontent.com/${owner}/${name}/${br}/`, web = `https://github.com/${owner}/${name}/blob/${br}/`;
  const abs = (u, base) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(u) ? (u.startsWith('/') && !u.startsWith('//') ? 'https://github.com' + u : u) : base + u.replace(/^\.\//, '');
  return h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/javascript:/gi, '')
    .replace(/<a ([^>]*?)href="([^"]*)"/g, (m, a, u) => `<a ${a}target="_blank" rel="noopener" href="${abs(u, web)}"`)
    .replace(/<img ([^>]*?)src="([^"]*)"/g, (m, a, u) => `<img ${a}loading="lazy" src="${abs(u, raw)}"`)
    .replace(/<a[^>]*class="anchor"[^>]*>[\s\S]*?<\/a>/g, '');
}
const REPO_SUBS = { issue: 'issues', issues: 'issues', star: 'stars', stars: 'stars', stargazers: 'stars', fork: 'forks', forks: 'forks', license: 'license', licence: 'license' };
const PER = 30;
const getRepoExtra = (owner, name, kind, state, page) => cached(`extra:${kind}:${owner}/${name}:${state}:${page}`.toLowerCase(), 5 * 60 * 1000, async () => {
  const base = `/repos/${owner}/${name}`;
  if (kind === 'issues') {
    const l = await rest(`${base}/issues?state=${state}&per_page=${PER}&page=${page}&sort=created&direction=desc`);
    return { more: l.length === PER, items: l.map((i) => ({ n: i.number, title: i.title, state: i.state, pr: !!i.pull_request, merged: !!(i.pull_request && i.pull_request.merged_at), author: i.user?.login || '', avatar: i.user?.avatar_url || '', comments: i.comments, at: i.created_at, closedAt: i.closed_at, url: i.html_url, labels: (i.labels || []).filter((x) => typeof x === 'object').map((x) => ({ name: x.name, color: /^[0-9a-fA-F]{6}$/.test(x.color || '') ? x.color : '888888' })) })) };
  }
  if (kind === 'stars') {
    const l = await rest(`${base}/stargazers?per_page=${PER * 2}&page=${page}`, 'application/vnd.github.star+json');
    return { more: l.length === PER * 2, items: l.map((x) => ({ login: x.user.login, avatar: x.user.avatar_url, url: x.user.html_url, at: x.starred_at })) };
  }
  if (kind === 'forks') {
    const l = await rest(`${base}/forks?per_page=${PER}&page=${page}&sort=newest`);
    return { more: l.length === PER, items: l.map((f) => ({ full: f.full_name, owner: f.owner.login, avatar: f.owner.avatar_url, url: f.html_url, stars: f.stargazers_count, description: f.description || '', at: f.pushed_at })) };
  }
  const j = await rest(`${base}/license`);
  const meta = j.license?.key ? await rest(`/licenses/${encodeURIComponent(j.license.key)}`).catch(() => ({})) : {};
  return { name: j.license?.name || j.name, spdx: j.license?.spdx_id && j.license.spdx_id !== 'NOASSERTION' ? j.license.spdx_id : '', file: j.name, url: j.html_url, size: j.size, description: meta.description || '', permissions: meta.permissions || [], conditions: meta.conditions || [], limitations: meta.limitations || [], body: Buffer.from(j.content || '', 'base64').toString('utf8') };
});
const getTree = (owner, name, ref) => cached(`tree:${owner}/${name}@${ref}`.toLowerCase(), 5 * 60 * 1000, async () => {
  const t = await rest(`/repos/${owner}/${name}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  return { tree: (t.tree || []).slice(0, 4000).map((x) => ({ p: x.path, d: x.type === 'tree' ? 1 : 0, s: x.size || 0 })), treeCut: !!t.truncated || (t.tree || []).length > 4000 };
});
const getFile = (owner, name, ref, p) => cached(`file:${owner}/${name}@${ref}:${p}`.toLowerCase(), 30 * 60 * 1000, async () => {
  const j = await rest(`/repos/${owner}/${name}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
  if (Array.isArray(j) || j.type !== 'file') throw new Error('not file');
  if (j.size > 300000) return { size: j.size, text: null };
  const buf = Buffer.from(j.content || '', 'base64');
  if (buf.includes(0)) return { size: j.size, text: null };
  return { size: j.size, text: buf.toString('utf8') };
});

// ---- in-site issue / pull request / commit pages ----
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const THREAD_WORDS = { pull: 1, pulls: 1, issue: 1, issues: 1 };
// GitHub's rendered comment HTML: strip scripts/handlers, keep same-repo links inside this site, open others in a new tab
function fixThread(h, owner, name, base) {
  const me = new RegExp(`^https://github\\.com/${reEsc(owner)}/${reEsc(name)}/(pull|issues|commit)/([0-9a-f]+)`, 'i');
  const abs = (u) => (u.startsWith('/') && !u.startsWith('//') ? 'https://github.com' + u : u);
  return (h || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/javascript:/gi, '')
    .replace(/<a ([^>]*?)href="([^"]*)"/g, (m, a, u) => {
      const x = me.exec(abs(u));
      if (x) return `<a ${a}href="${base}/${x[1].toLowerCase() === 'commit' ? 'commit' : x[1].toLowerCase() === 'issues' ? 'issues' : 'pull'}/${x[2]}"`;
      return `<a ${a}target="_blank" rel="noopener" href="${abs(u)}"`;
    })
    .replace(/<img ([^>]*?)src="([^"]*)"/g, (m, a, u) => `<img ${a}loading="lazy" src="${abs(u)}"`)
    .replace(/<a[^>]*class="anchor"[^>]*>[\s\S]*?<\/a>/g, '');
}
const ghUser = (u) => ({ login: (u && u.login) || 'ghost', avatar: (u && u.avatar_url) || '', url: (u && u.html_url) || '' });
const siteBase = (owner, name) => (owner.toLowerCase() === GH_USER.toLowerCase() ? `/repos/${name}` : `/repos/${owner}/${name}`);
const mapFiles = (l) => (l || []).map((f) => ({ name: f.filename, prev: f.previous_filename || '', status: f.status, add: f.additions || 0, del: f.deletions || 0, patch: f.patch || '', blob: f.blob_url || '' }));
const getThread = (owner, name, n) => cached(`thread:${owner}/${name}#${n}`.toLowerCase(), 2 * 60 * 1000, async () => {
  const b = `/repos/${owner}/${name}`, H = 'application/vnd.github.html+json', base = siteBase(owner, name);
  const fx = (h) => fixThread(h, owner, name, base);
  const i = await rest(`${b}/issues/${n}`, H);
  const isPr = !!i.pull_request;
  const [cm, pr, reviews, rcs] = await Promise.all([
    rest(`${b}/issues/${n}/comments?per_page=100`, H),
    isPr ? rest(`${b}/pulls/${n}`) : null,
    isPr ? rest(`${b}/pulls/${n}/reviews?per_page=100`, H).catch(() => []) : [],
    isPr ? rest(`${b}/pulls/${n}/comments?per_page=100`, H).catch(() => []) : [],
  ]);
  const timeline = [
    ...cm.map((c) => ({ k: 'c', id: c.id, user: ghUser(c.user), at: c.created_at, assoc: c.author_association, body: fx(c.body_html) })),
    ...reviews.filter((r) => r.state !== 'PENDING').map((r) => ({
      k: 'r', id: r.id, user: ghUser(r.user), at: r.submitted_at, state: r.state, assoc: r.author_association, body: fx(r.body_html),
      inline: rcs.filter((c) => c.pull_request_review_id === r.id).map((c) => ({ path: c.path, line: c.line || c.original_line || 0, user: ghUser(c.user), body: fx(c.body_html) })),
    })).filter((r) => r.body || r.inline.length || r.state !== 'COMMENTED'),
  ].sort((a, b2) => new Date(a.at) - new Date(b2.at));
  return {
    n: i.number, kind: isPr ? 'pull' : 'issue', title: i.title, state: i.state, reason: i.state_reason || '', merged: !!(pr && pr.merged), draft: !!(pr && pr.draft), locked: !!i.locked,
    author: ghUser(i.user), assoc: i.author_association, at: i.created_at, closedAt: i.closed_at, mergedAt: (pr && pr.merged_at) || null, mergedBy: pr && pr.merged_by ? ghUser(pr.merged_by) : null,
    labels: (i.labels || []).filter((x) => typeof x === 'object').map((x) => ({ name: x.name, color: /^[0-9a-fA-F]{6}$/.test(x.color || '') ? x.color : '888888' })),
    assignees: (i.assignees || []).map(ghUser), milestone: (i.milestone && i.milestone.title) || '', body: fx(i.body_html), commentsCount: i.comments, commentsCut: i.comments > 100, url: i.html_url, timeline,
    info: pr ? { base: pr.base.ref, head: pr.head.ref, headRepo: (pr.head.repo && pr.head.repo.full_name) || '', additions: pr.additions, deletions: pr.deletions, files: pr.changed_files, commits: pr.commits, mergeable: pr.mergeable_state || '' } : null,
  };
});
const getThreadPart = (owner, name, n, part) => cached(`threadp:${part}:${owner}/${name}#${n}`.toLowerCase(), 2 * 60 * 1000, async () => {
  const b = `/repos/${owner}/${name}/pulls/${n}`;
  if (part === 'files') return { files: mapFiles(await rest(`${b}/files?per_page=100`)) };
  const l = await rest(`${b}/commits?per_page=100`);
  return { commits: l.map((c) => ({ sha: c.sha, msg: (c.commit.message || '').split('\n')[0], author: (c.author && c.author.login) || (c.commit.author && c.commit.author.name) || '', avatar: (c.author && c.author.avatar_url) || '', at: c.commit.author && c.commit.author.date })) };
});
const getCommit = (owner, name, sha) => cached(`commit:${owner}/${name}@${sha}`.toLowerCase(), 30 * 60 * 1000, async () => {
  const c = await rest(`/repos/${owner}/${name}/commits/${sha}`);
  return {
    sha: c.sha, msg: c.commit.message || '', at: c.commit.author && c.commit.author.date, author: ghUser(c.author), authorName: (c.commit.author && c.commit.author.name) || '',
    parents: (c.parents || []).map((p) => p.sha), add: (c.stats && c.stats.additions) || 0, del: (c.stats && c.stats.deletions) || 0, url: c.html_url, files: mapFiles(c.files), filesCut: (c.files || []).length >= 300,
  };
});

const LANG_COLORS = { JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051', Go: '#00ADD8', Rust: '#dea584', Java: '#b07219', Vue: '#41b883', SCSS: '#c6538c', Dockerfile: '#384d54', 'C#': '#178600', C: '#555555', 'C++': '#f34b7d', Kotlin: '#A97BFF', Swift: '#F05138', PHP: '#4F5D95', Lua: '#000080', PowerShell: '#012456' };
const getRepoPage = (owner, name) => cached(`repopage2:${owner}/${name}`.toLowerCase(), 10 * 60 * 1000, async () => {
  const base = `/repos/${owner}/${name}`;
  const r = await rest(base);
  if (r.private) throw new Error('private');
  const [langs, commits, rel, contribs, tree, readme, branches, tags] = await Promise.all([
    rest(base + '/languages').catch(() => ({})), rest(base + '/commits?per_page=6').catch(() => []), rest(base + '/releases/latest').catch(() => null),
    rest(base + '/contributors?per_page=24').catch(() => []),
    rest(`${base}/git/trees/${encodeURIComponent(r.default_branch)}?recursive=1`).catch(() => ({ tree: [] })),
    ghHtml(base + '/readme').catch(() => null),
    rest(base + '/branches?per_page=100').catch(() => []), rest(base + '/tags?per_page=100').catch(() => []),
  ]);
  return {
    owner: r.owner.login, name: r.name, description: r.description, url: r.html_url, homepage: r.homepage || '', language: r.language, langColor: LANG_COLORS[r.language] || '#888',
    stars: r.stargazers_count, forks: r.forks_count, issues: r.open_issues_count, license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : '', archived: r.archived,
    topics: r.topics || [], pushedAt: r.pushed_at, createdAt: r.created_at, defaultBranch: r.default_branch,
    languages: Object.entries(langs).map(([k, v]) => ({ name: k, bytes: v, color: LANG_COLORS[k] || '#888' })),
    commits: commits.map((c) => ({ message: c.commit.message.split('\n')[0], author: c.author?.login || c.commit.author.name, date: c.commit.author.date, url: c.html_url })),
    release: rel ? { tag: rel.tag_name, url: rel.html_url } : null,
    contributors: (Array.isArray(contribs) ? contribs : []).map((c) => ({ login: c.login, avatar: c.avatar_url, url: c.html_url, n: c.contributions })),
    tree: (tree.tree || []).slice(0, 4000).map((t) => ({ p: t.path, d: t.type === 'tree' ? 1 : 0, s: t.size || 0 })),
    treeCut: !!tree.truncated || (tree.tree || []).length > 4000,
    branches: [r.default_branch, ...(Array.isArray(branches) ? branches.map((b) => b.name) : []).filter((n) => n !== r.default_branch)],
    tags: (Array.isArray(tags) ? tags : []).map((t) => t.name),
    readme: readme ? fixReadme(readme, owner, name, r.default_branch) : '',
  };
});
const getOrg = (login) => cached('org:' + login, ORG_TTL, () => buildOrg(login));

const isOwnerLogin = async (l) => l.toLowerCase() === GH_USER.toLowerCase() || (await getOrgNames()).some((n) => n.login.toLowerCase() === l.toLowerCase());
// Resolve "<name>[/<ref>/<path…>|/<sub>]" (main user) or "<owner>/<name>[…]" (orgs) into the repo page data and what part of it is shown.
// The main user's login is never an owner segment: a repo may share its name. wantTitle fetches the issue/PR/commit title.
async function resolveRepo(pathStr, wantTitle) {
  const parts = pathStr.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const ownerForm = parts.length >= 2 && parts[0].toLowerCase() !== GH_USER.toLowerCase() && (await isOwnerLogin(parts[0])) && /^[A-Za-z0-9._-]+$/.test(parts[1]);
  const [owner, name] = ownerForm ? [parts[0], parts[1]] : [GH_USER, parts[0]];
  const rest = parts.slice(ownerForm ? 2 : 1);
  if (!(await isOwnerLogin(owner)) || !/^[A-Za-z0-9._-]+$/.test(name || '')) return null;
  const d0 = await getRepoPage(owner, name);
  let sub = '', fpath = '', ttl = '', ref = '', thread = null, commit = null;
  const joined = rest.join('/'), refs = [...d0.branches, ...d0.tags].filter((b) => joined === b || joined.startsWith(b + '/')).sort((a, b) => b.length - a.length);
  const w0 = (rest[0] || '').toLowerCase();
  if (!refs.length && THREAD_WORDS[w0] && /^\d{1,7}$/.test(rest[1] || '') && (rest.length === 2 || (rest.length === 3 && ['files', 'commits'].includes(rest[2].toLowerCase())))) {
    sub = 'thread';
    if (wantTitle) try { thread = await getThread(d0.owner, d0.name, rest[1]); ttl = `${thread.title} (#${thread.n})`; } catch { ttl = `#${rest[1]}`; }
  } else if (!refs.length && (w0 === 'commit' || w0 === 'commits') && rest.length === 2 && /^[0-9a-f]{7,40}$/i.test(rest[1])) {
    sub = 'commit';
    if (wantTitle) try { commit = await getCommit(d0.owner, d0.name, rest[1]); ttl = `${commit.msg.split('\n')[0]} (${commit.sha.slice(0, 7)})`; } catch { ttl = rest[1].slice(0, 7); }
  } else if (rest.length === 1 && REPO_SUBS[rest[0].toLowerCase()] && !refs.length) sub = REPO_SUBS[rest[0].toLowerCase()];
  else { ref = refs.length ? refs[0] : rest[0] || ''; fpath = refs.length ? joined.slice(refs[0].length + 1) : rest.slice(1).join('/'); }
  const base = owner.toLowerCase() === GH_USER.toLowerCase() ? `/repos/${d0.name}` : `/repos/${d0.owner}/${d0.name}`;
  return { d0, owner, rest, sub, fpath, ttl, ref, thread, commit, base };
}
// ---- per-page OGP cards: /og/<site path>.png ----
const OG_V = Date.now().toString(36); // changes on every restart/deploy so link-preview caches refetch the image
const cardCache = new Map(); // pathname -> { t, v }
let cardRenders = [];       // timestamps of recent renders, to cap CPU (each render is ~200ms)
const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
const fmtC = (n) => { n = Number(n || 0); return n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : n < 1e6 ? Math.round(n / 1000) + 'K' : (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; };
const sizeStat = (b) => (b < 1000 ? [String(b), 'SIZE', 'B'] : b < 1048576 ? [(b < 102400 ? (b / 1024).toFixed(1).replace(/\.0$/, '') : String(Math.round(b / 1024))), 'SIZE', 'KB'] : [(b / 1048576).toFixed(1), 'SIZE', 'MB']);
const ago = (iso) => { const d = (Date.now() - new Date(iso)) / 86400000; return d < 1 ? 'today' : d < 30 ? `${Math.floor(d)}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${(d / 365).toFixed(1)}y ago`; };
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
async function cardFor(p) {
  const m = p.match(/^\/repos\/(.+)$/);
  if (!m && /^\/(followers|following|stars)$/.test(p)) {
    const u = (await getStats('week')).user, kind = p.slice(1);
    return { top: u.login, title: LIST_KINDS[kind], desc: u.bio, stats: [[fmtC(u.followers), 'FOLLOWERS'], [fmtC(u.following), 'FOLLOWING'], [fmtC(u.stars), 'STARS'], [fmtC(u.gists), 'GISTS']], meta: [] };
  }
  if (!m) {
    const org = p.match(/^\/([A-Za-z0-9-]+)$/);
    if (!org || org[1].toLowerCase() === GH_USER.toLowerCase() || !(await getOrgNames()).some((n) => n.login.toLowerCase() === org[1].toLowerCase())) return null;
    const d = await getOrg(org[1]);
    return { top: `GITHUB ORGANIZATION / ${d.org.login}`, title: d.org.name || d.org.login, desc: d.org.description,
      stats: [[fmtC(d.totals.repos), 'REPOS'], [fmtC(d.totals.stars), 'STARS'], [fmtC(d.totals.forks), 'FORKS'], [fmtC(d.totals.openPrs), 'OPEN PRS']],
      meta: [`${fmtN(d.org.members)} member${d.org.members === 1 ? '' : 's'}`, d.org.location, d.languages && d.languages[0] && d.languages[0].name] };
  }
  const R = await resolveRepo(m[1], true);
  if (!R) return null;
  const { d0, sub, fpath, ref, thread, commit } = R;
  const lang = d0.languages && d0.languages[0] ? d0.languages[0].name : d0.language;
  const repoStats = [[fmtC(d0.stars), 'STARS'], [fmtC(d0.forks), 'FORKS'], [fmtC(d0.issues), 'ISSUES'], [fmtC(d0.contributors.length), 'CONTRIBS']];
  const repoMeta = [lang, d0.license, d0.pushedAt && `updated ${ago(d0.pushedAt)}`, d0.archived && 'archived'];
  if (sub === 'thread') {
    const top = [d0.owner, `${d0.name} #${R.rest[1]} / ${R.rest[0].toLowerCase().startsWith('pull') ? 'pull request' : 'issue'}`];
    if (!thread) return { top, title: `#${R.rest[1]}`, desc: d0.description, stats: repoStats, meta: repoMeta };
    const st = thread.merged ? 'merged' : thread.draft ? 'draft' : thread.state;
    const meta = [st, `by ${thread.author.login}`, thread.at && `opened ${ago(thread.at)}`];
    let stats;
    if (thread.info) {
      meta.push(`${thread.info.head} -> ${thread.info.base}`);
      stats = [[`+${fmtC(thread.info.additions)}`, 'ADDITIONS'], [`-${fmtC(thread.info.deletions)}`, 'DELETIONS'], [fmtC(thread.info.files), 'FILES'], [fmtC(thread.info.commits), 'COMMITS']];
    } else stats = [[fmtC(thread.commentsCount), 'COMMENTS'], [fmtC(thread.labels.length), 'LABELS'], [fmtC(thread.assignees.length), 'ASSIGNEES']];
    return { top, title: thread.title || `#${thread.n}`, stats, meta };
  }
  if (sub === 'commit') {
    const top = [d0.owner, `${d0.name} / commit ${R.rest[1].slice(0, 7)}`];
    if (!commit) return { top, title: R.rest[1].slice(0, 7), desc: d0.description, stats: repoStats, meta: repoMeta };
    return { top, title: commit.msg.split('\n')[0] || commit.sha.slice(0, 7),
      stats: [[`+${fmtC(commit.add)}`, 'ADDITIONS'], [`-${fmtC(commit.del)}`, 'DELETIONS'], [fmtC(commit.files.length) + (commit.filesCut ? '+' : ''), 'FILES']],
      meta: [`by ${commit.author.login !== 'ghost' ? commit.author.login : commit.authorName}`, commit.at && `committed ${ago(commit.at)}`] };
  }
  if (sub) return { top: [d0.owner, d0.name], title: { issues: 'Issues', stars: 'Stargazers', forks: 'Forks', license: 'License' }[sub], desc: d0.description, stats: repoStats, meta: repoMeta };
  if (fpath) {
    const r = ref || d0.defaultBranch;
    let stats = repoStats.slice(0, 2).concat([repoStats[2]]), meta = [lang];
    try {
      const t = await getTree(d0.owner, d0.name, r), it = t.tree.find((x) => x.p === fpath);
      if (it && it.d) {
        const inside = t.tree.filter((x) => x.p.startsWith(fpath + '/'));
        stats = [[fmtC(inside.filter((x) => !x.p.slice(fpath.length + 1).includes('/')).length), 'ITEMS'], [fmtC(inside.filter((x) => !x.d).length), 'FILES'], sizeStat(inside.reduce((n, x) => n + (x.s || 0), 0)), repoStats[0]];
        meta.unshift('directory');
      } else if (it) {
        const f = await getFile(d0.owner, d0.name, r, fpath).catch(() => null);
        stats = [];
        if (f && f.text != null) stats.push([fmtC(f.text.split('\n').length - (f.text.endsWith('\n') ? 1 : 0)), 'LINES']);
        stats.push(sizeStat(it.s), repoStats[0], repoStats[1]);
        const ext = (fpath.match(/\.([A-Za-z0-9]+)$/) || [])[1];
        meta.unshift(ext ? `.${ext} file` : 'file');
      }
    } catch { /* no extra info */ }
    return { top: [d0.owner, `${d0.name} @ ${r}`], title: fpath, single: true, desc: d0.description, stats: stats.slice(0, 4), meta: meta.concat(d0.pushedAt && `updated ${ago(d0.pushedAt)}`) };
  }
  return { top: d0.owner, title: d0.name, desc: d0.description, stats: repoStats, meta: repoMeta };
}
// ---- profile lists: /followers /following /stars /gists ----
const LIST_KINDS = { followers: 'Followers', following: 'Following', stars: 'Stars', gists: 'Gists' };
const LIST_PER = 30;
const getList = (kind, after) => cached(`list2:${kind}:${after || ''}`, TTL, async () => {
  const U = 'login name avatarUrl bio url';
  const q = {
    followers: `followers(first:${LIST_PER}, after:$a){ totalCount pageInfo{ hasNextPage endCursor } nodes{ ${U} } }`,
    following: `following(first:${LIST_PER}, after:$a){ totalCount pageInfo{ hasNextPage endCursor } nodes{ ${U} } }`,
    stars: `repositories(first:${LIST_PER}, after:$a, ownerAffiliations:OWNER, privacy:PUBLIC, isFork:false, orderBy:{field:STARGAZERS, direction:DESC}){ totalCount pageInfo{ hasNextPage endCursor } nodes{ name description stargazerCount forkCount pushedAt primaryLanguage{ name color } } }`,
    gists: `gists(first:${LIST_PER}, after:$a, privacy:PUBLIC, orderBy:{field:PUSHED_AT, direction:DESC}){ totalCount pageInfo{ hasNextPage endCursor } nodes{ name description url pushedAt stargazerCount files(limit:3){ name } } }`,
  }[kind];
  const d = await gql(`query($l:String!,$a:String){ user(login:$l){ ${q} } }`, { l: GH_USER, a: after || null });
  const c = d.user[kind === 'stars' ? 'repositories' : kind];
  const items = c.nodes.map((n) => kind === 'stars'
    ? { name: n.name, description: n.description || '', stars: n.stargazerCount, forks: n.forkCount, at: n.pushedAt, lang: n.primaryLanguage }
    : kind === 'gists'
      ? { id: n.name, description: n.description || '', url: n.url, stars: n.stargazerCount, at: n.pushedAt, files: n.files.map((f) => f.name) }
      : { login: n.login, name: n.name || '', bio: n.bio || '', avatar: n.avatarUrl, url: n.url });
  // Stars lists only repositories that have stars (sorted by stars, so the first zero ends the list)
  const kept = kind === 'stars' ? items.filter((x) => x.stars > 0) : items, more = c.pageInfo.hasNextPage && kept.length === items.length;
  return { kind, total: kind === 'stars' ? undefined : c.totalCount, items: kept, next: more ? c.pageInfo.endCursor : '' };
});
let ogCache = null;
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Put the final tab title into the served HTML so it never changes after the page loads.
const withTitle = (html, name) => {
  const t = escHtml(`${name} · GitHub`);
  return html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`).replace(/(<meta property="og:title" content=")[^"]*"/, `$1${t}"`);
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(302, { Location: '/overview' + url.search, 'Cache-Control': 'no-cache' }); return res.end(); }
  if (url.pathname.startsWith('/og/') && url.pathname.endsWith('.png')) {
    try {
      let p = url.pathname.slice(3, -4).replace(/\/+$/, '');
      try { p = decodeURIComponent(p); } catch { /* keep raw */ }
      const hit = cardCache.get(p);
      let v = hit && Date.now() - hit.t < 10 * 60 * 1000 ? hit.v : null;
      if (!v) {
        const card = await cardFor(p);
        if (!card) { res.writeHead(404); return res.end(); }
        const now = Date.now();
        cardRenders = cardRenders.filter((t) => now - t < 60000);
        if (cardRenders.length >= 20) { res.writeHead(429, { 'Retry-After': '30' }); return res.end(); }
        cardRenders.push(now);
        v = renderCard(card);
        cardCache.set(p, { t: now, v });
        while (cardCache.size > 60) cardCache.delete(cardCache.keys().next().value);
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' });
      return res.end(v);
    } catch (e) { console.error('og card', e.message); res.writeHead(404); return res.end(); }
  }
  if (url.pathname === '/api/stats') {
    const period = PERIODS.includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'week';
    try {
      const v = await getStats(period);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' });
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
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
      return res.end(JSON.stringify(await getYear(y)));
    } catch (e) { console.error(e.message); res.writeHead(502); return res.end(); }
  }
  if (url.pathname === '/api/org') {
    try {
      const want = (url.searchParams.get('name') || '').toLowerCase();
      const login = (await getOrgNames()).find((n) => n.login.toLowerCase() === want)?.login;
      if (!login) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not_found"}'); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' });
      return res.end(JSON.stringify({ ...(await getOrg(login)), orgNames: await getOrgNames(), me: orgList.me }));
    } catch (e) { console.error(e.message); res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end('{"error":"upstream_error"}'); }
  }
  if (url.pathname === '/api/repo-extra') {
    try {
      const [owner, name] = (url.searchParams.get('name') || '').split('/');
      const kind = url.searchParams.get('kind') || '', st = url.searchParams.get('state') || 'open';
      const page = Math.min(50, Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1));
      const okOwner = owner && (owner.toLowerCase() === GH_USER.toLowerCase() || (await getOrgNames()).some((n) => n.login.toLowerCase() === owner.toLowerCase()));
      if (!okOwner || !/^[A-Za-z0-9._-]+$/.test(name || '') || !['issues', 'stars', 'forks', 'license'].includes(kind) || !['open', 'closed', 'all'].includes(st)) { res.writeHead(400); return res.end(); }
      await getRepoPage(owner, name);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' });
      return res.end(JSON.stringify(await getRepoExtra(owner, name, kind, st, page)));
    } catch (e) { res.writeHead(404); return res.end(); }
  }
  if (url.pathname === '/api/repo-thread' || url.pathname === '/api/repo-commit') {
    try {
      const [owner, name] = (url.searchParams.get('name') || '').split('/');
      const okOwner = owner && (owner.toLowerCase() === GH_USER.toLowerCase() || (await getOrgNames()).some((n) => n.login.toLowerCase() === owner.toLowerCase()));
      if (!okOwner || !/^[A-Za-z0-9._-]+$/.test(name || '')) { res.writeHead(400); return res.end(); }
      await getRepoPage(owner, name);
      let out;
      if (url.pathname === '/api/repo-commit') {
        const sha = url.searchParams.get('sha') || '';
        if (!/^[0-9a-f]{7,40}$/i.test(sha)) { res.writeHead(400); return res.end(); }
        out = await getCommit(owner, name, sha);
      } else {
        const n = url.searchParams.get('n') || '', part = url.searchParams.get('part') || 'main';
        if (!/^\d{1,7}$/.test(n) || !['main', 'files', 'commits'].includes(part)) { res.writeHead(400); return res.end(); }
        out = part === 'main' ? await getThread(owner, name, n) : await getThreadPart(owner, name, n, part);
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' });
      return res.end(JSON.stringify(out));
    } catch (e) { res.writeHead(404); return res.end(); }
  }
  if (url.pathname === '/api/repo-tree') {
    try {
      const [owner, name] = (url.searchParams.get('name') || '').split('/'), ref = url.searchParams.get('ref') || '';
      const okOwner = owner && (owner.toLowerCase() === GH_USER.toLowerCase() || (await getOrgNames()).some((n) => n.login.toLowerCase() === owner.toLowerCase()));
      if (!okOwner || !/^[A-Za-z0-9._-]+$/.test(name || '') || !ref || ref.includes('..') || !/^[A-Za-z0-9._\/@+-]+$/.test(ref)) { res.writeHead(400); return res.end(); }
      await getRepoPage(owner, name);
      const t = await getTree(owner, name, ref);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' });
      return res.end(JSON.stringify(t));
    } catch (e) { res.writeHead(404); return res.end(); }
  }
  if (url.pathname === '/api/repo-file') {
    try {
      const [owner, name] = (url.searchParams.get('name') || '').split('/');
      const p = url.searchParams.get('path') || '', ref = url.searchParams.get('ref') || '';
      const okOwner = owner && (owner.toLowerCase() === GH_USER.toLowerCase() || (await getOrgNames()).some((n) => n.login.toLowerCase() === owner.toLowerCase()));
      if (!okOwner || !/^[A-Za-z0-9._-]+$/.test(name || '') || !p || p.includes('..') || !/^[A-Za-z0-9._\/@+-]+$/.test(ref)) { res.writeHead(400); return res.end(); }
      await getRepoPage(owner, name);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
      return res.end(JSON.stringify(await getFile(owner, name, ref, p)));
    } catch (e) { res.writeHead(404); return res.end(); }
  }
  if (url.pathname === '/api/repo' || /^\/repos\/[^/]+(?:\/.*)?$/.test(url.pathname)) {
    try {
      const R = await resolveRepo(url.pathname === '/api/repo' ? (url.searchParams.get('name') || '') : url.pathname.replace(/^\/repos\//, ''), url.pathname !== '/api/repo');
      if (!R) { res.writeHead(404); return res.end(); }
      const { d0, owner, rest, sub, fpath, ttl, base } = R;
      const d = { ...d0, base };
      if (url.pathname === '/api/repo') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' });
        return res.end(JSON.stringify(d));
      }
      const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const pagePath = `${base}${sub && !ttl ? '/' + sub : rest.length ? '/' + rest.map(encodeURIComponent).join('/') : ''}`;
      const html = fs.readFileSync(path.join(PUBLIC, 'repo.html'), 'utf8')
        .replace(/__TITLE__/g, esc(`${d.owner}/${d.name}${ttl ? ' · ' + ttl : sub ? ' · ' + ({ issues: 'Issues', stars: 'Stargazers', forks: 'Forks', license: 'License' })[sub] : fpath ? ' · ' + fpath : ''}`)).replace(/__SUB__/g, sub).replace(/__DESC__/g, esc(d.description || `${d.owner}/${d.name} on GitHub`))
        .replace(/__URL__/g, esc(`https://gh.lapius7.com${pagePath}`)).replace(/__IMG__/g, esc(`https://gh.lapius7.com/og${pagePath}.png?v=${OG_V}`));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    } catch (e) { console.error(e.message); res.writeHead(404); return res.end(); }
  }
  if (url.pathname === '/api/people') {
    const kind = url.searchParams.get('kind'), after = url.searchParams.get('after') || '';
    if (!LIST_KINDS[kind] || !/^[A-Za-z0-9=_-]{0,80}$/.test(after)) { res.writeHead(400); return res.end(); }
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' });
      return res.end(JSON.stringify(await getList(kind, after)));
    } catch (e) { console.error(e.message); res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end('{"error":"upstream_error"}'); }
  }
  if (url.pathname === '/api/gist') {
    const id = url.searchParams.get('id') || '';
    if (!/^[0-9a-f]{20,40}$/i.test(id)) { res.writeHead(400); return res.end(); }
    try {
      const g = await rest('/gists/' + id);
      if (!g.public || (g.owner?.login || '').toLowerCase() !== GH_USER.toLowerCase()) { res.writeHead(404); return res.end(); }
      const files = Object.values(g.files).slice(0, 20).map((f) => ({ name: f.filename, content: (f.content || '').slice(0, 200000), truncated: !!f.truncated || (f.content || '').length > 200000 }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' });
      return res.end(JSON.stringify({ id, description: g.description || '', url: g.html_url, updated: g.updated_at, files }));
    } catch (e) { res.writeHead(404); return res.end(); }
  }
  if (/^\/gist\/[0-9a-fA-F]{20,40}\/?$/.test(url.pathname)) {
    return fs.readFile(path.join(PUBLIC, 'gist.html'), (err, buf) => {
      res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(err ? undefined : buf);
    });
  }
  const lk = url.pathname.match(/^\/(followers|following|stars)\/?$/);
  if (lk) {
    return fs.readFile(path.join(PUBLIC, 'list.html'), (err, buf) => {
      res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(err ? undefined : withTitle(buf.toString(), LIST_KINDS[lk[1]]).replace(/__KIND__/g, lk[1]).replace(/__OGIMG__/g, escHtml(`https://gh.lapius7.com/og/${lk[1]}.png?v=${OG_V}`)).replace(/__OGNAME__/g, escHtml(LIST_KINDS[lk[1]])));
    });
  }
  const seg = url.pathname.match(/^\/([A-Za-z0-9-]+)(?:\/(?:overview|work|activity|repos))?\/?$/);
  if (seg && !fs.existsSync(path.join(PUBLIC, seg[1]))) {
    try {
      if ((await getOrgNames()).some((n) => n.login.toLowerCase() === seg[1].toLowerCase())) {
        let name = seg[1];
        try { const o = (await getOrg(seg[1])).org; name = o.name || o.login; } catch (e) { console.error(e.message); }
        return fs.readFile(path.join(PUBLIC, 'org.html'), (err, buf) => { res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(err ? undefined : withTitle(buf.toString(), name).replace(/__OGIMG__/g, escHtml(`https://gh.lapius7.com/og/${seg[1]}.png?v=${OG_V}`)).replace(/__OGNAME__/g, escHtml(name))); });
      }
    } catch (e) { console.error(e.message); }
  }
  const rel = url.pathname === '/' || /^\/(overview|work|activity|repos|gists)\/?$/.test(url.pathname) ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  let pageName = '';
  if (rel === '/index.html') { try { const u = (await getStats('week')).user; pageName = u.name || u.login; } catch (e) { console.error(e.message); } }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    // OG image URL gets a fresh random query so crawlers never reuse a stale cache
    const body = path.extname(file) === '.html'
      ? (pageName ? withTitle(buf.toString(), pageName) : buf.toString()).replace(/\/og\.png"/g, `/og.png?v=${Math.random().toString(36).slice(2, 10)}"`)
      : buf;
    res.end(body);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`gh.lapius7.com on :${PORT}`);
  warm();
  setInterval(warm, TTL - 30 * 1000).unref();
});

// Keep every view's cache hot so visitors never wait on GitHub. Cheap when fresh; staggered when not.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function warm() {
  const y = new Date().getUTCFullYear();
  const jobs = [...PERIODS.map((p) => () => getStats(p)), ...Array.from({ length: 6 }, (_, i) => () => getYear(y - i)),
    async () => { for (const o of await getOrgNames()) { await getOrg(o.login).catch((e) => console.error('warm org', e.message)); await sleep(500); } }];
  for (const j of jobs) { try { await j(); } catch (e) { console.error('warm:', e.message); } await sleep(500); }
}
