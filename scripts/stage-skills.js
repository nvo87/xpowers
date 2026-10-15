#!/usr/bin/env node

// Single entry point for per-stage skill configuration: resolve what a stage must load,
// and verify from a subagent transcript that it really loaded it.
const fs = require("node:fs")
const path = require("node:path")
const { verify } = require("./verify-stage-skills.js")
const os = require("node:os")

const CONFIG_NAME = path.join(".claude", "xpowers-skills.json")
const SKILL_STAGES = ["brainstorm", "plan", "implement"]
const REVIEW_STAGES = ["task-review", "final-review", "final-gate"]
const FINISH_MODES = ["keep-branch", "merge-local"]

const USAGE = `Usage:
  stage-skills.js resolve <stage> [--config <path>]
  stage-skills.js verify --agent-id <id> --require <a,b> [--projects-dir <dir>]
  stage-skills.js agents

Stages: ${[...SKILL_STAGES, ...REVIEW_STAGES, "finish"].join(", ")}
Config: nearest ${CONFIG_NAME} walking up from the current directory.

resolve exit codes: 0 configured or not configured (see "configured"), 2 invalid config or usage.
verify exit codes: 0 OK, 1 MISSING, 2 NOT_FOUND.`

function fail(message) {
  console.log(JSON.stringify({ status: "ERROR", error: message }, null, 2))
  process.exit(2)
}

function findConfig(startDir) {
  let dir = path.resolve(startDir)
  for (;;) {
    const candidate = path.join(dir, CONFIG_NAME)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function builtinAgents() {
  const dir = path.join(__dirname, "..", "agents")
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "CLAUDE.md")
    .map((f) => f.replace(/\.md$/, ""))
}

function asSkillList(value, where) {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.some((s) => typeof s !== "string" || !s)) {
    throw new Error(`${where} must be an array of skill names`)
  }
  return value
}

function asReviewers(value, where, agents) {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${where} must be a non-empty array of reviewers`)
  const names = new Set()
  return value.map((r, i) => {
    const at = `${where}[${i}]`
    if (!r || typeof r.name !== "string" || !r.name) throw new Error(`${at}.name is required`)
    if (names.has(r.name)) throw new Error(`${at}.name "${r.name}" is duplicated`)
    names.add(r.name)
    const agent = String(r.agent || "").replace(/^xpowers:/, "")
    if (!agents.includes(agent)) throw new Error(`${at}.agent "${r.agent}" is not a built-in XPowers agent (${agents.join(", ")})`)
    return { name: r.name, agent: `xpowers:${agent}`, focus: r.focus || "", skills: asSkillList(r.skills || [], `${at}.skills`) }
  })
}

function resolve(stage, configPath) {
  const all = [...SKILL_STAGES, ...REVIEW_STAGES, "finish"]
  if (!all.includes(stage)) throw new Error(`Unknown stage "${stage}". Expected one of: ${all.join(", ")}`)
  if (!configPath) return stage === "finish" ? { configured: false, stage, mode: "keep-branch", skills: [] } : { configured: false, stage }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  const profileName = config.profile
  const profile = config.profiles && config.profiles[profileName]
  if (!profile) throw new Error(`Profile "${profileName}" not found in ${configPath}`)
  const where = `profiles.${profileName}.${stage}`
  const base = { configured: true, config: configPath, profile: profileName, stage }

  if (SKILL_STAGES.includes(stage)) {
    const skills = asSkillList(profile[stage], where)
    return skills ? { ...base, skills } : { configured: false, config: configPath, profile: profileName, stage }
  }
  if (REVIEW_STAGES.includes(stage)) {
    const reviewers = asReviewers(profile[stage], where, builtinAgents())
    return reviewers ? { ...base, reviewers } : { configured: false, config: configPath, profile: profileName, stage }
  }
  const finish = profile.finish || {}
  const mode = finish.mode || "keep-branch"
  if (!FINISH_MODES.includes(mode)) throw new Error(`${where}.mode must be one of: ${FINISH_MODES.join(", ")}`)
  return { ...base, mode, skills: asSkillList(finish.skills || [], `${where}.skills`) }
}

function option(args, name) {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === "-h" || command === "--help") {
    console.error(USAGE)
    process.exit(command ? 0 : 2)
  }

  if (command === "agents") {
    console.log(JSON.stringify(builtinAgents(), null, 2))
    return
  }

  if (command === "resolve") {
    const stage = args[0]
    if (!stage) fail(`Stage is required.\n${USAGE}`)
    try {
      const explicit = option(args, "--config")
      const result = resolve(stage, explicit ? path.resolve(explicit) : findConfig(process.cwd()))
      console.log(JSON.stringify(result, null, 2))
    } catch (error) {
      fail(error.message)
    }
    return
  }

  if (command === "verify") {
    const agentId = option(args, "--agent-id")
    if (!agentId) fail(`--agent-id is required.\n${USAGE}`)
    const result = verify({
      agentId,
      require: (option(args, "--require") || "").split(",").map((s) => s.trim()).filter(Boolean),
      projectsDir: option(args, "--projects-dir") || path.join(os.homedir(), ".claude", "projects"),
      sessionId: process.env.CLAUDE_CODE_SESSION_ID,
    })
    console.log(JSON.stringify(result, null, 2))
    process.exit({ OK: 0, MISSING: 1, NOT_FOUND: 2 }[result.status])
  }

  fail(`Unknown command "${command}".\n${USAGE}`)
}

if (require.main === module) main()

module.exports = { resolve, findConfig, builtinAgents }
