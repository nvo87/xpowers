const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const SCRIPT = path.join(__dirname, "..", "scripts", "stage-skills.js")

function project(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-skills-"))
  const nested = path.join(root, "backend", "src")
  fs.mkdirSync(nested, { recursive: true })
  if (config) {
    fs.mkdirSync(path.join(root, ".claude"))
    fs.writeFileSync(path.join(root, ".claude", "xpowers-skills.json"), JSON.stringify(config))
  }
  return nested
}

function resolve(cwd, stage) {
  const res = spawnSync("node", [SCRIPT, "resolve", stage], { cwd, encoding: "utf8" })
  return { code: res.status, out: JSON.parse(res.stdout) }
}

const CONFIG = {
  profile: "a",
  profiles: {
    a: {
      implement: ["fans-django-services"],
      "task-review": [
        { name: "tests", agent: "autonomous-reviewer", focus: "tests", skills: ["fans-django-tests"] },
        { name: "arch", agent: "xpowers:autonomous-reviewer", skills: ["fans-django-review"] },
      ],
    },
    b: { implement: ["karpathy-guidelines"] },
  },
}

test("config is found by walking up from a nested directory", () => {
  const { code, out } = resolve(project(CONFIG), "implement")
  assert.equal(code, 0)
  assert.deepEqual(out.skills, ["fans-django-services"])
  assert.equal(out.profile, "a")
})

test("switching profile changes the resolved skills", () => {
  const { out } = resolve(project({ ...CONFIG, profile: "b" }), "implement")
  assert.deepEqual(out.skills, ["karpathy-guidelines"])
})

test("reviewers resolve with namespaced built-in agents", () => {
  const { out } = resolve(project(CONFIG), "task-review")
  assert.deepEqual(
    out.reviewers.map((r) => r.agent),
    ["xpowers:autonomous-reviewer", "xpowers:autonomous-reviewer"],
  )
})

test("missing stage key means not configured", () => {
  const { code, out } = resolve(project(CONFIG), "brainstorm")
  assert.equal(code, 0)
  assert.equal(out.configured, false)
})

test("no config file means not configured and finish keeps the branch", () => {
  assert.equal(resolve(project(null), "plan").out.configured, false)
  assert.equal(resolve(project(null), "finish").out.mode, "keep-branch")
})

test("non built-in reviewer agent is rejected", () => {
  const bad = { profile: "a", profiles: { a: { "task-review": [{ name: "x", agent: "django-executor" }] } } }
  const { code, out } = resolve(project(bad), "task-review")
  assert.equal(code, 2)
  assert.match(out.error, /not a built-in XPowers agent/)
})

test("unknown profile is an error", () => {
  const { code } = resolve(project({ profile: "zzz", profiles: {} }), "implement")
  assert.equal(code, 2)
})
