const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const SCRIPT = path.join(__dirname, "..", "scripts", "verify-stage-skills.js")

function makeProjects(agentId, entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-skills-"))
  const dir = path.join(root, "-proj", "session-1", "subagents")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `agent-${agentId}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n"))
  return root
}

function skillCall(id, skill) {
  return { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill } }] } }
}

function skillResult(id, isError) {
  return { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError }] } }
}

function run(args) {
  const res = spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" })
  return { code: res.status, out: res.stdout ? JSON.parse(res.stdout) : null }
}

test("OK when every required skill was invoked successfully", () => {
  const dir = makeProjects("a1", [skillCall("t1", "fans-django-tests"), skillResult("t1", false), skillCall("t2", "xpowers:test-driven-development")])
  const { code, out } = run(["--agent-id", "a1", "--require", "fans-django-tests,test-driven-development", "--projects-dir", dir])
  assert.equal(code, 0)
  assert.equal(out.status, "OK")
})

test("MISSING when a required skill was never invoked", () => {
  const dir = makeProjects("a2", [skillCall("t1", "fans-django-tests")])
  const { code, out } = run(["--agent-id", "a2", "--require", "fans-django-tests,fans-django-review", "--projects-dir", dir])
  assert.equal(code, 1)
  assert.deepEqual(out.missing, ["fans-django-review"])
})

test("a failed Skill call does not count as loaded", () => {
  const dir = makeProjects("a3", [skillCall("t1", "fans-django-tests"), skillResult("t1", true)])
  const { code, out } = run(["--agent-id", "a3", "--require", "fans-django-tests", "--projects-dir", dir])
  assert.equal(code, 1)
  assert.deepEqual(out.missing, ["fans-django-tests"])
})

test("skill mentioned only in text does not count", () => {
  const dir = makeProjects("a4", [{ type: "assistant", message: { content: [{ type: "text", text: "Loaded fans-django-tests" }] } }])
  const { code } = run(["--agent-id", "a4", "--require", "fans-django-tests", "--projects-dir", dir])
  assert.equal(code, 1)
})

test("NOT_FOUND when transcript is absent", () => {
  const dir = makeProjects("a5", [])
  const { code, out } = run(["--agent-id", "missing", "--require", "x", "--projects-dir", dir])
  assert.equal(code, 2)
  assert.equal(out.status, "NOT_FOUND")
})
