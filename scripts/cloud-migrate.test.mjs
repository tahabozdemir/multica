import assert from "node:assert/strict";
import test from "node:test";

import { makeRewriter } from "./cloud-migrate.mjs";

const SRC_ATTACHMENT = "11111111-1111-4111-8111-111111111111";
const DST_ATTACHMENT = "22222222-2222-4222-8222-222222222222";

function rewriter(maps = {}) {
  const snap = {
    workspace: { slug: "siriusa" },
    source: { app_url: "https://multica.ai" },
    files: {
      [SRC_ATTACHMENT]: {
        source: {
          url: `https://static.multica.ai/workspaces/w/${SRC_ATTACHMENT}.png`,
          markdown_url: `https://api.multica.ai/api/attachments/${SRC_ATTACHMENT}/download`,
        },
      },
    },
  };
  const state = {
    maps: {
      issue: { "src-issue": "dst-issue" },
      project: {},
      doc: {},
      attachment: { [SRC_ATTACHMENT]: { id: DST_ATTACHMENT, url: `http://localhost:8080/api/attachments/${DST_ATTACHMENT}/download` } },
      ...maps,
    },
  };
  return makeRewriter({ snap, state, targetAppUrl: "http://localhost:3000", targetSlug: () => "siriusa-local" });
}

test("agent, member, squad, and @all mentions become plain text", () => {
  const out = rewriter()(
    "[@Siri](mention://agent/a1) [Taha](mention://member/u1) [@Ops](mention://squad/s1) [@all](mention://all/all)",
  );
  assert.equal(out, "@Siri @Taha @Ops @all");
  assert.doesNotMatch(out, /mention:\/\//);
});

test("issue mentions point at the imported issue, or fall back to their label", () => {
  const out = rewriter()("[SIRI-1](mention://issue/src-issue) and [SIRI-9](mention://issue/unknown)");
  assert.equal(out, "[SIRI-1](mention://issue/dst-issue) and SIRI-9");
});

test("attachment links in every form point at the uploaded copy", () => {
  const dst = `http://localhost:8080/api/attachments/${DST_ATTACHMENT}/download`;
  const out = rewriter()(
    [
      `![a](https://static.multica.ai/workspaces/w/${SRC_ATTACHMENT}.png?Signature=x&Expires=1)`,
      `![b](https://api.multica.ai/api/attachments/${SRC_ATTACHMENT}/download)`,
      `[c](/api/attachments/${SRC_ATTACHMENT}/download)`,
    ].join("\n"),
  );
  assert.equal(out, [`![a](${dst})`, `![b](${dst})`, `[c](${dst})`].join("\n"));
  assert.doesNotMatch(out, /multica\.ai/);
});

test("links into the source app move to the new workspace", () => {
  const out = rewriter()("See https://multica.ai/siriusa/issues/SIRI-4 and https://example.com/x");
  assert.equal(out, "See http://localhost:3000/siriusa-local/issues/SIRI-4 and https://example.com/x");
});
