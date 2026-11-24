#!/usr/bin/env node
// Copy one Multica workspace from one server (e.g. Multica Cloud) to another
// (e.g. your local server), in two separate steps:
//
//   export  Reads one workspace from the SOURCE with GET requests only and
//           writes a snapshot folder: snapshot.json plus attachment files.
//           This is the only step that contacts the source.
//   import  Writes a snapshot into a NEW workspace on the TARGET. It refuses
//           a non-loopback target unless --allow-remote-target is given.
//
// The import never starts agent work: issues are never assigned to agents or
// squads, agent/member mentions become plain text, every comment is posted
// with suppress_agent_ids for all agents, and the run ends by checking that
// the new workspace has no agent tasks. Authors, assignees, and timestamps the
// API cannot set are kept as a short note on each issue and comment.
//
// Usage:
//   node scripts/cloud-migrate.mjs export --source-profile <name> [--workspace <slug|id>] --out <dir>
//   node scripts/cloud-migrate.mjs import --in <dir> --target-profile <name> [--slug <slug>] [--name <name>] [--dry-run]
//
// Profiles are the CLI's (~/.multica/profiles/<name>/config.json); tokens are
// read from there and never printed or written to the snapshot. --source-url /
// --target-url and MULTICA_MIGRATE_SOURCE_TOKEN / MULTICA_MIGRATE_TARGET_TOKEN
// override them. Import progress is kept in <dir>/import-state.json, so a
// failed import can be re-run and continues where it stopped.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = Number(process.env.MULTICA_MIGRATE_PAGE) || 100;
const USER_AGENT = "multica-cloud-migrate/1";

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) opts[key] = true;
    else {
      opts[key] = next;
      i++;
    }
  }
  return { command, opts };
}

function loadProfile(name) {
  const path = join(homedir(), ".multica", "profiles", name, "config.json");
  if (!existsSync(path)) throw new Error(`no CLI profile "${name}" (${path})`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function endpoint(opts, side) {
  const profile = opts[`${side}-profile`] ? loadProfile(opts[`${side}-profile`]) : {};
  const baseUrl = String(opts[`${side}-url`] || profile.server_url || "").replace(/\/+$/, "");
  const token = process.env[`MULTICA_MIGRATE_${side.toUpperCase()}_TOKEN`] || profile.token;
  if (!baseUrl) throw new Error(`--${side}-profile or --${side}-url is required`);
  if (!token) throw new Error(`no token for the ${side} (profile or MULTICA_MIGRATE_${side.toUpperCase()}_TOKEN)`);
  return { baseUrl: baseUrl.replace(/^ws(s?):/, "http$1:").replace(/\/ws$/, ""), token, appUrl: profile.app_url };
}

function isLoopback(url) {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

// ---------------------------------------------------------------- http

class Api {
  constructor({ baseUrl, token, readOnly }) {
    this.baseUrl = baseUrl;
    this.origin = new URL(baseUrl).origin;
    this.token = token;
    this.readOnly = readOnly;
    this.workspaceId = "";
    this.requests = 0;
  }

  headers(extra = {}) {
    const h = { Authorization: `Bearer ${this.token}`, "User-Agent": USER_AGENT, Accept: "application/json", ...extra };
    if (this.workspaceId) h["X-Workspace-ID"] = this.workspaceId;
    return h;
  }

  async request(method, path, { body, form, allowStatus = [] } = {}) {
    if (this.readOnly && method !== "GET") throw new Error(`refusing ${method} ${path}: the source is read-only`);
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      const res = await fetch(url, {
        method,
        headers: this.headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        redirect: "manual",
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
        continue;
      }
      if (allowStatus.includes(res.status)) return { status: res.status, data: await safeJson(res) };
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        throw new Error(`${method} ${path} → ${res.status}: ${text}`);
      }
      return res.status === 204 ? null : safeJson(res);
    }
  }

  get(path, opts) {
    return this.request("GET", path, opts);
  }
  post(path, body, opts) {
    return this.request("POST", path, { ...opts, body });
  }
  put(path, body) {
    return this.request("PUT", path, { body });
  }
  delete(path) {
    return this.request("DELETE", path);
  }
}

async function safeJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const listOf = (data, key) => (Array.isArray(data) ? data : (data?.[key] ?? []));

// ---------------------------------------------------------------- export

async function runExport(opts) {
  const out = opts.out;
  if (!out) throw new Error("--out <dir> is required");
  if (existsSync(join(out, "snapshot.json")) && !opts.force) throw new Error(`${out} already has a snapshot (use --force to overwrite)`);
  const src = new Api({ ...endpoint(opts, "source"), readOnly: true });

  const me = await src.get("/api/me");
  const workspaces = listOf(await src.get("/api/workspaces"), "workspaces");
  const pick = opts.workspace;
  const ws = pick
    ? workspaces.find((w) => w.slug === pick || w.id === pick || w.name === pick)
    : workspaces.length === 1
      ? workspaces[0]
      : null;
  if (!ws) {
    console.log("Pick a workspace with --workspace <slug>:");
    for (const w of workspaces) console.log(`  ${w.slug}  (${w.name}, prefix ${w.issue_prefix})`);
    process.exitCode = 2;
    return;
  }
  src.workspaceId = ws.id;
  const q = `workspace_id=${ws.id}`;
  console.log(`Exporting "${ws.name}" (${ws.slug}) from ${src.origin} …`);

  const snapshot = {
    format: 1,
    exported_at: new Date().toISOString(),
    source: { origin: src.origin, app_url: opts["source-app-url"] || deriveAppUrl(src.baseUrl) },
    me: { id: me.id, name: me.name, email: me.email },
    workspace: ws,
    members: listOf(await src.get(`/api/workspaces/${ws.id}/members`), "members"),
    runtimes: listOf(await src.get(`/api/runtimes?${q}`), "runtimes"),
    agents: listOf(await src.get(`/api/agents?${q}&include_archived=true`), "agents"),
    statuses: listOf(await src.get("/api/issue-statuses?include_archived=true"), "statuses"),
    labels: listOf(await src.get("/api/labels?resource_type=issue"), "labels"),
    properties: listOf(await src.get("/api/properties?include_usage=false"), "properties"),
    projects: await paginate(src, `/api/projects?${q}&include_archived=true`, "projects"),
    skills: [],
    issues: [],
    docs: null,
    files: {},
  };

  for (const skill of listOf(await src.get("/api/skills"), "skills")) {
    const detail = await src.get(`/api/skills/${skill.id}?include=content`);
    const files = await src.get(`/api/skills/${skill.id}/files`, { allowStatus: [404] });
    snapshot.skills.push({ ...skill, ...detail, files: listOf(files?.data ?? files, "files") });
  }

  const issues = await paginate(src, `/api/issues?${q}`, "issues");
  let comments = 0;
  for (const issue of issues.sort((a, b) => a.number - b.number)) {
    issue.comments = listOf(await src.get(`/api/issues/${issue.id}/comments`), "comments");
    issue.attachment_list = listOf(await src.get(`/api/issues/${issue.id}/attachments`), "attachments");
    comments += issue.comments.length;
    snapshot.issues.push(issue);
    process.stdout.write(`\r  issues ${snapshot.issues.length}/${issues.length}, comments ${comments}   `);
  }
  process.stdout.write("\n");

  const docs = await src.get("/api/docs", { allowStatus: [400, 403, 404] });
  if (docs?.data?.code || docs?.status) {
    snapshot.docs = { disabled: true };
  } else {
    const tree = docs;
    const full = [];
    for (const doc of tree.docs ?? []) full.push(await src.get(`/api/docs/${doc.id}`));
    snapshot.docs = { folders: tree.folders ?? [], docs: full };
  }

  // Attachments: only files this deployment serves (its API origin or a CDN
  // host under the same domain). Images that markdown links to elsewhere are
  // never fetched.
  mkdirSync(join(out, "files"), { recursive: true, mode: 0o700 });
  const attachments = new Map();
  for (const issue of snapshot.issues) {
    for (const a of issue.attachment_list) attachments.set(a.id, a);
    for (const c of issue.comments) for (const a of c.attachments ?? []) attachments.set(a.id, a);
  }
  let n = 0;
  for (const a of attachments.values()) {
    n++;
    process.stdout.write(`\r  attachments ${n}/${attachments.size}   `);
    const file = await downloadAttachment(src, a);
    if (file) {
      const path = join("files", `${a.id}-${basename(a.filename || "file").replace(/[^\w.-]/g, "_")}`);
      writeFileSync(join(out, path), file.bytes, { mode: 0o600 });
      snapshot.files[a.id] = { path, filename: a.filename, content_type: file.type, size: file.bytes.length, sha256: sha256(file.bytes), source: a };
    } else {
      snapshot.files[a.id] = { missing: true, filename: a.filename, source: a };
    }
  }
  if (attachments.size) process.stdout.write("\n");

  mkdirSync(out, { recursive: true, mode: 0o700 });
  writeFileSync(join(out, "snapshot.json"), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  chmodSync(out, 0o700);
  printSummary("Exported", snapshot);
  console.log(`  ${src.requests} GET requests to ${src.origin}; snapshot in ${out}`);
}

async function paginate(api, path, key) {
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const data = await api.get(`${path}&limit=${PAGE}&offset=${offset}`);
    const page = listOf(data, key);
    all.push(...page);
    const total = data?.total;
    const more = data?.has_more ?? (typeof total === "number" ? all.length < total : page.length === PAGE);
    if (!more || page.length === 0) return all;
  }
}

function registrableDomain(host) {
  return host.split(".").slice(-2).join(".");
}

async function downloadAttachment(api, a) {
  const res = await fetch(`${api.baseUrl}/api/attachments/${a.id}/download`, { headers: api.headers(), redirect: "manual" });
  api.requests++;
  let final = res;
  if (res.status >= 300 && res.status < 400) {
    const location = new URL(res.headers.get("location"), api.baseUrl);
    const sameDeployment =
      location.origin === api.origin || registrableDomain(location.hostname) === registrableDomain(new URL(api.baseUrl).hostname);
    if (!sameDeployment) {
      console.warn(`\n  skip attachment ${a.filename}: redirect to ${location.hostname} is outside the source deployment`);
      return null;
    }
    // Signed CDN URLs carry their own credentials; never send the API token there.
    final = await fetch(location, { headers: { "User-Agent": USER_AGENT } });
    api.requests++;
  }
  if (!final.ok) {
    console.warn(`\n  skip attachment ${a.filename}: HTTP ${final.status}`);
    return null;
  }
  return { bytes: Buffer.from(await final.arrayBuffer()), type: final.headers.get("content-type") || "application/octet-stream" };
}

function deriveAppUrl(apiBase) {
  const url = new URL(apiBase);
  if (url.hostname.startsWith("api.")) url.hostname = url.hostname.slice(4);
  return url.origin;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------- import

async function runImport(opts) {
  const dir = opts.in;
  if (!dir) throw new Error("--in <dir> is required");
  const snap = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));
  const target = endpoint(opts, "target");
  if (!isLoopback(target.baseUrl) && !opts["allow-remote-target"]) {
    throw new Error(`target ${target.baseUrl} is not on this machine; pass --allow-remote-target to write there anyway`);
  }
  const dry = Boolean(opts["dry-run"]);
  const tgt = new Api({ ...target, readOnly: dry });
  const statePath = join(dir, "import-state.json");
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : { maps: { status: {}, label: {}, project: {}, agent: {}, skill: {}, issue: {}, comment: {}, attachment: {}, doc: {}, folder: {} }, placeholders: [] };
  const notes = [];
  const save = () => !dry && writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  const M = state.maps;

  const me = await tgt.get("/api/me");
  const srcMemberName = new Map(snap.members.map((m) => [m.user_id, m.name || m.email]));
  const srcAgentName = new Map(snap.agents.map((a) => [a.id, a.name]));
  const srcIsMe = (type, id) => type === "member" && id === snap.me.id;
  const actorName = (type, id) =>
    type === "agent" ? `${srcAgentName.get(id) ?? "unknown agent"} (agent)` : type === "squad" ? "a squad" : (srcMemberName.get(id) ?? "unknown member");

  printSummary(dry ? "Dry run: would import" : "Importing", snap);

  // Workspace
  if (!state.workspace_id) {
    const body = {
      name: opts.name || snap.workspace.name,
      slug: opts.slug || snap.workspace.slug,
      description: snap.workspace.description || undefined,
      context: snap.workspace.context || undefined,
      issue_prefix: snap.workspace.issue_prefix,
    };
    if (dry) {
      console.log(`  would create workspace "${body.name}" (${body.slug}, prefix ${body.issue_prefix})`);
      state.workspace_id = "dry-run";
    } else {
      const created = await tgt.post("/api/workspaces", body);
      state.workspace_id = created.id;
      state.workspace_slug = created.slug;
      save();
      console.log(`  created workspace "${created.name}" (${created.slug})`);
    }
  }
  tgt.workspaceId = dry ? "" : state.workspace_id;
  const q = `workspace_id=${state.workspace_id}`;

  // Issue statuses (system ones exist already; match by key)
  const existingStatuses = dry ? [] : listOf(await tgt.get("/api/issue-statuses?include_archived=true"), "statuses");
  for (const s of existingStatuses) M.status[s.key] ??= s.key;
  for (const s of snap.statuses) {
    if (M.status[s.key] || s.archived_at || s.is_system) continue;
    if (!dry) await tgt.post("/api/issue-statuses", { key: s.key, name: s.name, description: s.description || undefined, category: s.category, color: s.color, icon: s.icon || "" });
    M.status[s.key] = s.key;
    console.log(`  status: ${s.name}`);
  }
  const statusByCategory = Object.fromEntries(existingStatuses.filter((s) => s.is_system).map((s) => [s.category, s.key]));
  const mapStatus = (issue) => M.status[issue.status] ?? statusByCategory[issue.status_category] ?? issue.status_category ?? "backlog";
  save();

  // Labels
  const existingLabels = dry ? [] : listOf(await tgt.get("/api/labels?resource_type=issue"), "labels");
  for (const l of snap.labels) {
    if (M.label[l.id]) continue;
    const same = existingLabels.find((x) => x.name === l.name);
    M.label[l.id] = same ? same.id : dry ? `dry-${l.id}` : (await tgt.post("/api/labels", { resource_type: "issue", name: l.name, description: l.description || undefined, color: l.color })).id;
  }
  save();

  // Projects
  for (const p of snap.projects) {
    if (M.project[p.id]) continue;
    const body = {
      title: p.title,
      description: p.description || undefined,
      icon: p.icon || undefined,
      status: p.status || undefined,
      priority: p.priority || undefined,
      start_date: p.start_date || undefined,
      due_date: p.due_date || undefined,
      ...(srcIsMe(p.lead_type, p.lead_id) ? { lead_type: "member", lead_id: me.id } : {}),
    };
    M.project[p.id] = dry ? `dry-${p.id}` : (await tgt.post("/api/projects", body)).id;
    save();
  }

  // Skills
  if (!opts["skip-skills"]) {
    for (const s of snap.skills) {
      if (M.skill[s.id]) continue;
      const files = (s.files ?? []).filter((f) => typeof f.content === "string").map((f) => ({ path: f.path, content: f.content }));
      const body = { name: s.name, description: s.description || undefined, content: s.content || undefined, files: files.length ? files : undefined };
      if (dry) M.skill[s.id] = `dry-${s.id}`;
      else {
        const res = await tgt.post("/api/skills", body, { allowStatus: [409] });
        M.skill[s.id] = res?.status === 409 ? (await tgt.post("/api/skills", { ...body, name: `${s.name} (imported)` })).id : res.id;
      }
      save();
    }
  }

  // Agents: definitions only, bound to a local runtime of the same provider.
  // Secrets (custom env, MCP config) are not readable from the source and are
  // not copied.
  if (!opts["skip-agents"]) {
    const runtimes = dry ? [] : listOf(await tgt.get(`/api/runtimes?${q}`), "runtimes");
    const srcProvider = new Map(snap.runtimes.map((r) => [r.id, r.provider]));
    for (const a of snap.agents) {
      if (M.agent[a.id] || a.archived_at) continue;
      const provider = srcProvider.get(a.runtime_id);
      if (dry) {
        M.agent[a.id] = `dry-${a.id}`;
        continue;
      }
      const runtime = runtimes.find((r) => r.provider === provider) ?? null;
      if (!runtime) {
        notes.push(`agent "${a.name}" (${provider ?? "unknown"} runtime) not created: no ${provider ?? ""} runtime in the new workspace yet. Start the daemon, then re-run the import.`);
        continue;
      }
      const body = {
        name: a.name,
        description: a.description || undefined,
        instructions: a.instructions || undefined,
        runtime_id: runtime.id,
        model: a.model || undefined,
        custom_args: Array.isArray(a.custom_args) && a.custom_args.length ? a.custom_args : undefined,
        max_concurrent_tasks: a.max_concurrent_tasks || undefined,
        thinking_level: a.thinking_level || undefined,
        conversation_starters: a.conversation_starters?.length ? a.conversation_starters : undefined,
      };
      M.agent[a.id] = (await tgt.post("/api/agents", body)).id;
      if (a.has_custom_env || a.mcp_config_redacted) notes.push(`agent "${a.name}": re-enter its custom environment / MCP config by hand (secrets are not exported)`);
      save();
    }
  }
  const allTargetAgents = dry ? [] : listOf(await tgt.get(`/api/agents?${q}&include_archived=true`), "agents").map((a) => a.id);

  // Attachments are uploaded on first use and reused after that.
  const uploadAttachment = async (srcId) => {
    if (M.attachment[srcId]) return M.attachment[srcId];
    const f = snap.files[srcId];
    if (!f || f.missing) return null;
    if (dry) return (M.attachment[srcId] = { id: `dry-${srcId}`, url: `dry-${srcId}` });
    const form = new FormData();
    form.append("file", new Blob([readFileSync(join(dir, f.path))], { type: f.content_type }), f.filename || "file");
    const up = await tgt.request("POST", "/api/upload-file", { form });
    M.attachment[srcId] = { id: up.id, url: up.markdown_url || up.attachment_download_url || up.url };
    save();
    return M.attachment[srcId];
  };

  const rewrite = makeRewriter({ snap, state, targetAppUrl: target.appUrl, targetSlug: () => state.workspace_slug });

  // Issues, in number order. When the new workspace starts empty, gaps in the
  // source numbering are filled with placeholders (deleted at the end) so
  // SIRI-42 stays SIRI-42 and identifiers in text keep pointing right.
  const existingIssues = dry ? [] : await paginate(tgt, `/api/issues?${q}`, "issues");
  let nextNumber = existingIssues.length ? Math.max(...existingIssues.map((i) => i.number)) + 1 : 1;
  const preserveNumbers = !existingIssues.some((i) => !Object.values(M.issue).includes(i.id) && !state.placeholders.includes(i.id));
  if (!preserveNumbers) notes.push("the new workspace already had issues, so issue numbers were not preserved");

  let created = 0;
  for (const issue of snap.issues) {
    if (M.issue[issue.id]) continue;
    while (preserveNumbers && nextNumber < issue.number) {
      if (!dry) {
        const ph = await tgt.post("/api/issues", { title: "Import placeholder (deleted after import)", status: "cancelled" });
        state.placeholders.push(ph.id);
        save();
      }
      nextNumber++;
    }
    const attachmentIds = [];
    for (const a of issue.attachment_list.filter((x) => !x.comment_id)) {
      const up = await uploadAttachment(a.id);
      if (up) attachmentIds.push(up.id);
    }
    const assignee = srcIsMe(issue.assignee_type, issue.assignee_id) ? { assignee_type: "member", assignee_id: me.id } : {};
    const footer = issueFooter(issue, snap, actorName);
    const body = {
      title: issue.title,
      description: `${rewrite(issue.description || "")}${footer}`,
      status: mapStatus(issue),
      priority: issue.priority || undefined,
      project_id: issue.project_id ? M.project[issue.project_id] : undefined,
      label_ids: (issue.labels ?? []).map((l) => M.label[l.id]).filter(Boolean),
      start_date: issue.start_date || undefined,
      due_date: issue.due_date || undefined,
      attachment_ids: attachmentIds.length ? attachmentIds : undefined,
      ...assignee,
    };
    if (dry) M.issue[issue.id] = `dry-${issue.id}`;
    else {
      const res = await tgt.post("/api/issues", body);
      M.issue[issue.id] = res.id;
      if (preserveNumbers && res.number !== issue.number) notes.push(`${snap.workspace.issue_prefix}-${issue.number} became ${res.identifier}`);
      nextNumber = res.number + 1;
    }
    created++;
    save();
    process.stdout.write(`\r  issues ${created}   `);
  }
  process.stdout.write("\n");

  // Second pass: parents, stages, blockers, and descriptions whose issue
  // links pointed at issues created later.
  for (const issue of snap.issues) {
    const id = M.issue[issue.id];
    const update = {};
    if (issue.parent_issue_id && M.issue[issue.parent_issue_id]) {
      update.parent_issue_id = M.issue[issue.parent_issue_id];
      if (issue.stage) update.stage = issue.stage;
    }
    const blockers = (issue.blocked_by ?? []).map((b) => M.issue[b.id ?? b]).filter(Boolean);
    if (blockers.length) update.blocked_by = blockers;
    if (/mention:\/\/issue\//.test(issue.description || "")) update.description = `${rewrite(issue.description)}${issueFooter(issue, snap, actorName)}`;
    if (Object.keys(update).length && !dry && !state.updated?.[issue.id]) {
      await tgt.put(`/api/issues/${id}`, update);
      (state.updated ??= {})[issue.id] = true;
      save();
    }
  }

  // Comments, oldest first, so parents exist before their replies.
  let posted = 0;
  for (const issue of snap.issues) {
    const ordered = [...issue.comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const c of ordered) {
      if (M.comment[c.id]) continue;
      const attachmentIds = [];
      for (const a of c.attachments ?? []) {
        const up = await uploadAttachment(a.id);
        if (up) attachmentIds.push(up.id);
      }
      const header = `*${actorName(c.author_type, c.author_id)} · ${fmtTime(c.created_at)}${c.resolved_at ? " · resolved" : ""}${c.type && c.type !== "comment" ? ` · ${c.type}` : ""}*\n\n`;
      const body = {
        content: header + rewrite(c.content || ""),
        type: "comment",
        parent_id: c.parent_id ? M.comment[c.parent_id] : undefined,
        attachment_ids: attachmentIds.length ? attachmentIds : undefined,
        suppress_agent_ids: allTargetAgents.length ? allTargetAgents : undefined,
      };
      M.comment[c.id] = dry ? `dry-${c.id}` : (await tgt.post(`/api/issues/${M.issue[issue.id]}/comments`, body)).id;
      posted++;
      save();
      process.stdout.write(`\r  comments ${posted}   `);
    }
  }
  if (posted) process.stdout.write("\n");

  // Docs (only when both sides have Docs turned on).
  if (snap.docs && !snap.docs.disabled && (snap.docs.docs?.length || snap.docs.folders?.length)) {
    const probe = dry ? null : await tgt.get("/api/docs", { allowStatus: [400, 403, 404] });
    if (probe?.data?.code) {
      notes.push(`${snap.docs.docs.length} docs not imported: Docs is turned off on the target (set FF_DOCS_V1=true and re-run). They are in snapshot.json.`);
    } else {
      const folders = [...snap.docs.folders];
      while (folders.some((f) => !M.folder[f.id])) {
        for (const f of folders) {
          if (M.folder[f.id] || (f.parent_id && !M.folder[f.parent_id])) continue;
          M.folder[f.id] = dry ? `dry-${f.id}` : (await tgt.post("/api/doc-folders", { title: f.title, parent_id: f.parent_id ? M.folder[f.parent_id] : null })).id;
          save();
        }
      }
      for (const d of snap.docs.docs) {
        if (M.doc[d.id]) continue;
        const body = { title: d.title, content: rewrite(d.content || ""), folder_id: d.folder_id ? M.folder[d.folder_id] : null, message: "Imported" };
        M.doc[d.id] = dry ? `dry-${d.id}` : (await tgt.post("/api/docs", body)).id;
        save();
      }
    }
  }

  // Placeholders go last so they never let the counter fall behind.
  if (!dry) {
    for (const id of state.placeholders) {
      if (state.deleted_placeholders?.includes(id)) continue;
      await tgt.delete(`/api/issues/${id}`);
      (state.deleted_placeholders ??= []).push(id);
      save();
    }
  }

  // Safety check: the import must not have started any agent work.
  if (!dry) {
    const tasks = listOf(await tgt.get("/api/agent-task-snapshot"), "tasks").filter((t) => Object.values(M.issue).includes(t.issue_id));
    console.log(tasks.length === 0 ? "  ✓ no agent tasks were started" : `  ✗ ${tasks.length} agent task(s) reference imported issues — check the workspace`);
  }

  const skippedProps = snap.properties.length;
  if (skippedProps) notes.push(`${skippedProps} custom propert${skippedProps === 1 ? "y" : "ies"} and their values were not imported`);
  save();
  console.log(`\n${dry ? "Dry run done" : "Done"}: ${Object.keys(M.issue).length} issues, ${Object.keys(M.comment).length} comments, ${Object.keys(M.attachment).length} attachments, ${Object.keys(M.project).length} projects, ${Object.keys(M.agent).length} agents, ${Object.keys(M.skill).length} skills, ${Object.keys(M.doc).length} docs.`);
  for (const n of [...new Set(notes)]) console.log(`  note: ${n}`);
  console.log(`  ${tgt.requests} requests to ${tgt.origin}`);
}

function issueFooter(issue, snap, actorName) {
  const parts = [`${snap.workspace.issue_prefix}-${issue.number}`, `created ${fmtTime(issue.created_at)}`];
  if (issue.creator_id) parts.push(`by ${actorName(issue.creator_type, issue.creator_id)}`);
  if (issue.assignee_id && !(issue.assignee_type === "member" && issue.assignee_id === snap.me.id)) {
    parts.push(`assigned to ${actorName(issue.assignee_type, issue.assignee_id)}`);
  }
  return `\n\n---\n*Imported from ${snap.source.origin}: ${parts.join(" · ")}*`;
}

function fmtTime(iso) {
  return iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "";
}

// Rewrites links in markdown so nothing points back at the source and no
// mention can notify or start an agent: agent/member/all mentions become
// plain text, issue/project/doc mentions point at the imported copies,
// attachment URLs at the uploaded files, and app links at the new workspace.
export function makeRewriter({ snap, state, targetAppUrl, targetSlug }) {
  const M = state.maps;
  const attachmentUrls = [];
  for (const [srcId, f] of Object.entries(snap.files)) {
    for (const key of ["url", "download_url", "attachment_download_url", "markdown_url"]) {
      const u = f.source?.[key];
      if (typeof u === "string" && u) attachmentUrls.push([u.split("?")[0], srcId]);
    }
  }
  attachmentUrls.sort((a, b) => b[0].length - a[0].length);
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return (text) => {
    if (!text) return text;
    let out = text.replace(/\[([^\]]*)\]\(mention:\/\/(member|agent|squad|all|issue|project|doc)\/([^)\s]+)\)/g, (whole, label, type, id) => {
      const mapped = { issue: M.issue, project: M.project, doc: M.doc }[type]?.[id];
      if (mapped) return `[${label}](mention://${type}/${mapped})`;
      const plain = label.startsWith("@") ? label : `@${label}`;
      return type === "issue" || type === "project" || type === "doc" ? label : plain;
    });
    for (const [url, srcId] of attachmentUrls) {
      const to = M.attachment[srcId]?.url;
      if (to) out = out.replace(new RegExp(`${escape(url)}(\\?[^)\\s"']*)?`, "g"), to);
    }
    out = out.replace(/(?:https?:\/\/[^\s)"']+)?\/api\/attachments\/([0-9a-f-]{36})\/(download|content)/g, (whole, srcId) => M.attachment[srcId]?.url ?? whole);
    const appUrl = snap.source.app_url;
    if (appUrl && targetAppUrl && targetSlug()) {
      out = out.replaceAll(`${appUrl}/${snap.workspace.slug}/`, `${targetAppUrl.replace(/\/+$/, "")}/${targetSlug()}/`);
    }
    return out;
  };
}

function printSummary(verb, snap) {
  const comments = snap.issues.reduce((n, i) => n + i.comments.length, 0);
  const files = Object.values(snap.files);
  const bytes = files.reduce((n, f) => n + (f.size || 0), 0);
  console.log(`${verb} workspace "${snap.workspace.name}" (${snap.workspace.slug}, prefix ${snap.workspace.issue_prefix}):`);
  console.log(`  ${snap.issues.length} issues, ${comments} comments, ${files.length} attachments (${(bytes / 1e6).toFixed(1)} MB${files.some((f) => f.missing) ? `, ${files.filter((f) => f.missing).length} missing` : ""})`);
  console.log(`  ${snap.projects.length} projects, ${snap.labels.length} labels, ${snap.statuses.filter((s) => !s.is_system).length} custom statuses, ${snap.properties.length} custom properties`);
  console.log(`  ${snap.agents.length} agents, ${snap.skills.length} skills, ${snap.docs?.disabled ? "Docs off" : `${snap.docs?.docs?.length ?? 0} docs`}, ${snap.members.length} members`);
}

// ---------------------------------------------------------------- main

function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const run = { export: runExport, import: runImport }[command];
  if (!run) {
    console.error("usage: cloud-migrate.mjs export|import [options]   (see the header of this file)");
    process.exit(2);
  }
  run(opts).catch((err) => {
    console.error(`\nerror: ${err.message}`);
    process.exit(1);
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
