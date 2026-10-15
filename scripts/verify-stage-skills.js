#!/usr/bin/env node

// Proves a subagent really invoked the stage skills by reading its Claude Code transcript,
// instead of trusting the skill list the subagent reports in its summary.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const USAGE = `Usage: verify-stage-skills.js --agent-id <id> --require <skill,skill,...> [--projects-dir <dir>]

Exit codes: 0 OK (all required skills loaded), 1 MISSING, 2 NOT_FOUND or usage error.
Prints one JSON object to stdout.`

function parseArgs(argv) {
  const args = { require: [] }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === "--agent-id") args.agentId = value
    else if (key === "--require") args.require = (value || "").split(",").map((s) => s.trim()).filter(Boolean)
    else if (key === "--projects-dir") args.projectsDir = value
    else if (key === "-h" || key === "--help") args.help = true
    else throw new Error(`Unknown argument: ${key}`)
    i++
  }
  return args
}

function findTranscript(projectsDir, agentId, sessionId) {
  const fileName = `agent-${agentId.replace(/^agent-/, "")}.jsonl`
  if (!fs.existsSync(projectsDir)) return null
  for (const project of fs.readdirSync(projectsDir)) {
    const projectDir = path.join(projectsDir, project)
    if (!fs.statSync(projectDir).isDirectory()) continue
    const sessions = fs.readdirSync(projectDir)
    if (sessionId && sessions.includes(sessionId)) sessions.unshift(sessionId)
    for (const session of sessions) {
      const candidate = path.join(projectDir, session, "subagents", fileName)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

function readSkillCalls(transcriptPath) {
  const calls = new Map()
  const failed = new Set()
  for (const line of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const content = entry.message && Array.isArray(entry.message.content) ? entry.message.content : []
    for (const block of content) {
      if (block.type === "tool_use" && block.name === "Skill" && block.input && block.input.skill) {
        calls.set(block.id, block.input.skill)
      }
      if (block.type === "tool_result" && block.is_error) failed.add(block.tool_use_id)
    }
  }
  return [...calls].map(([id, skill]) => ({ skill, ok: !failed.has(id) }))
}

function sameSkill(a, b) {
  return a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`)
}

function verify({ agentId, require, projectsDir, sessionId }) {
  const transcript = findTranscript(projectsDir, agentId, sessionId)
  if (!transcript) {
    return { status: "NOT_FOUND", agentId, required: require, loaded: [], missing: require }
  }
  const loaded = readSkillCalls(transcript)
  const missing = require.filter((req) => !loaded.some((call) => call.ok && sameSkill(call.skill, req)))
  return { status: missing.length ? "MISSING" : "OK", agentId, transcript, required: require, loaded, missing }
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`)
    process.exit(2)
  }
  if (args.help || !args.agentId) {
    console.error(USAGE)
    process.exit(args.help ? 0 : 2)
  }
  const result = verify({
    agentId: args.agentId,
    require: args.require,
    projectsDir: args.projectsDir || path.join(os.homedir(), ".claude", "projects"),
    sessionId: process.env.CLAUDE_CODE_SESSION_ID,
  })
  console.log(JSON.stringify(result, null, 2))
  process.exit({ OK: 0, MISSING: 1, NOT_FOUND: 2 }[result.status])
}

if (require.main === module) main()

module.exports = { verify, readSkillCalls, sameSkill }
