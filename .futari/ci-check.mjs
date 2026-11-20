#!/usr/bin/env node
// Validate PR metadata and evidence as data. This does not attest that tests ran.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const fail = message => { throw new Error(message); };
function git(args, encoding = 'utf8') {
  try { return execFileSync('git', args, { encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }); }
  catch { fail(`Required Git evidence is unavailable: git ${args.join(' ')}`); }
}
function parse(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(`Invalid JSON in ${label}`); }
}
function marker(body, name, pattern) {
  if (typeof body !== 'string') fail(`Missing ${name} marker`);
  const candidates = body.split(/\r?\n/).filter(line => line.trimStart().startsWith(`${name}:`));
  if (candidates.length !== 1) fail(`Require exactly one ${name}: marker`);
  const match = candidates[0].match(new RegExp(`^${name}: (${pattern})$`));
  if (!match) fail(`Invalid ${name}: marker; use one exact line without indentation or trailing spaces`);
  return match[1];
}
function containsId(body, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(body);
}
function readGitFile(revision, filename) {
  const listing = git(['ls-tree', revision, '--', filename]).trim();
  if (!/^100(?:644|755) blob /.test(listing)) fail(`Missing or non-regular committed evidence file: ${filename}`);
  return git(['show', `${revision}:${filename}`], null);
}

export function main(env = process.env) {
  const base = env.BASE_SHA;
  if (!SHA.test(base ?? '')) fail('BASE_SHA must be a full trusted base commit SHA');
  if (!env.GITHUB_EVENT_PATH || !env.FUTARI_GATE_PATH) fail('GITHUB_EVENT_PATH and FUTARI_GATE_PATH are required');
  const event = parse(fs.readFileSync(env.GITHUB_EVENT_PATH), 'GitHub event');
  const pr = event.pull_request;
  if (!pr || pr.base?.sha !== base) fail('BASE_SHA does not match this pull request event');
  const head = git(['rev-parse', 'HEAD']).trim();
  if (!SHA.test(pr.head?.sha ?? '') || head !== pr.head.sha) fail('Checkout must be the pull request head SHA, not a different or synthetic merge commit');
  const plan = parse(readGitFile(base, '.futari/plan.json'), 'base plan');
  if (typeof plan.repository !== 'string' || event.repository?.full_name?.toLowerCase() !== plan.repository.toLowerCase()) fail('GitHub event repository does not match the approved plan.repository');
  if (pr.base.repo?.full_name && pr.base.repo.full_name.toLowerCase() !== plan.repository.toLowerCase()) fail('Pull request base repository does not match the approved repository');
  const planId = marker(pr.body, 'Futari-Plan', '[A-Za-z][A-Za-z0-9_-]*');
  const taskId = marker(pr.body, 'Futari-Task', '[A-Za-z][A-Za-z0-9_-]*');
  if (planId !== plan.planId) fail(`PR plan marker ${planId} does not match approved plan ${plan.planId}`);
  const task = plan.tasks?.find(t => t.id === taskId);
  if (!task) fail(`PR references unknown approved task ${taskId}`);
  const expectedGate = readGitFile(base, '.futari/plan-gate.mjs');
  if (!fs.readFileSync(env.FUTARI_GATE_PATH).equals(expectedGate)) fail('FUTARI_GATE_PATH is not the gate extracted from the trusted base commit');
  const result = spawnSync(process.execPath, [env.FUTARI_GATE_PATH, 'ci', '--base', base, '--task', taskId], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) fail(`Plan gate rejected the PR:\n${result.stdout ?? ''}${result.stderr ?? result.error?.message ?? ''}`);
  const evidencePath = `.futari/evidence/${taskId}.md`;
  const evidence = readGitFile(head, evidencePath).toString('utf8');
  if (marker(evidence, 'Futari-Plan', '[A-Za-z][A-Za-z0-9_-]*') !== planId ||
      marker(evidence, 'Futari-Task', '[A-Za-z][A-Za-z0-9_-]*') !== taskId) fail('Evidence plan/task markers do not match this PR');
  if (marker(evidence, 'Verdict', '[A-Z_]+') !== 'VERIFIED') fail('Evidence verdict must be VERIFIED');
  const tested = marker(evidence, 'Tested-Commit', '[a-f0-9]{40}|[a-f0-9]{64}');
  git(['cat-file', '-e', `${tested}^{commit}`]);
  if (spawnSync('git', ['merge-base', '--is-ancestor', tested, head], { stdio: 'ignore' }).status !== 0) fail('Tested-Commit must be an ancestor of the PR head');
  const afterTest = git(['diff', '--name-only', '-z', '--no-renames', tested, head, '--']).split('\0').filter(Boolean);
  const metadata = new Set([evidencePath, 'docs/futari/PROGRESS.md']);
  const changedCode = afterTest.filter(name => !metadata.has(name));
  if (changedCode.length) fail(`Evidence is stale; files differ from Tested-Commit: ${changedCode.join(', ')}`);
  for (const id of [...task.requirementIds, ...task.evalIds]) {
    if (!containsId(pr.body, id)) fail(`PR body is missing approved traceability ID ${id}`);
    if (!containsId(evidence, id)) fail(`Evidence is missing approved traceability ID ${id}`);
  }
  process.stdout.write(result.stdout);
  console.log(`PASS ${planId}/${taskId}: PR markers, committed evidence, revision freshness and traceability checked. This verifies evidence structure, not that tests or independent review actually ran.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`FUTARI CI: ${error.message}`); process.exitCode = 1; }
}
