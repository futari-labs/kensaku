#!/usr/bin/env node
// FutariLabs plan gate. Node.js >=22; no dependencies; no command strings are executed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLAN = '.futari/plan.json';
const APPROVAL = '.futari/approval.json';
export const REQUIRED_FILES = [
  PLAN, '.futari/plan-gate.mjs', '.futari/ci-check.mjs', '.agents/playbooks/futari-approved-plan.md',
  '.claude/pstack-models.md',
  'CLAUDE.md', 'docs/futari/PRODUCT_SPEC.md', 'docs/futari/ARCHITECTURE.md',
  'docs/futari/EVALUATION_PLAN.md', 'docs/futari/EXECUTION_PLAN.md',
  'docs/futari/DECISIONS.md', 'docs/futari/RISKS.md',
  'docs/futari/PSTACK_HANDOFF.md', '.github/workflows/futari-contract.yml',
];
const MARKER = /\b(?:TODO|TBD|TBC|FIXME|REPLACE_ME|FILL_ME|SET_DURING_BOOTSTRAP)\b/;
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = message => { throw new Error(message); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...values].sort();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || MARKER.test(value) ||
      /^(?:unknown|placeholder|<[^>]*>|\[[^\]]*\])$/i.test(value.trim())) {
    fail(`${label}: supply a concrete, non-placeholder value`);
  }
  return value;
}

function strings(value, label, empty = false) {
  if (!Array.isArray(value) || (!empty && !value.length)) fail(`${label}: expected ${empty ? 'an' : 'a nonempty'} array`);
  for (const item of value) text(item, label);
  if (new Set(value).size !== value.length) fail(`${label}: duplicate values`);
  return value;
}

function relativeFile(value, label = 'file') {
  text(value, label);
  if (value.includes('\\') || /[\x00-\x1f]/.test(value) || path.posix.isAbsolute(value) ||
      path.posix.normalize(value) !== value || value.split('/').some(p => p === '..' || p === '.' || p === '.git') ||
      value.endsWith('/') || value.includes('*')) fail(`${label}: must be an exact, safe repository-relative file path: ${value}`);
  return value;
}

function scopePath(value) {
  text(value, 'allowedPaths');
  let bare = value.endsWith('/**') ? value.slice(0, -3) : value.replace(/\/$/, '');
  relativeFile(bare, 'allowedPaths');
  return value;
}

function git(root, args, encoding = 'utf8') {
  try { return execFileSync('git', ['-C', root, ...args], { encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }); }
  catch { fail(`Git command failed: git ${args.join(' ')}. Run from a Git repository with the required commits available.`); }
}

function workingReader(root) {
  return name => {
    relativeFile(name);
    let location = root;
    for (const part of name.split('/')) {
      location = path.join(location, part);
      let stat;
      try { stat = fs.lstatSync(location); } catch { fail(`Missing protected file: ${name}`); }
      if (stat.isSymbolicLink()) fail(`Symlinks are not allowed in protected file paths: ${name}`);
    }
    if (!fs.statSync(location).isFile()) fail(`Expected a regular protected file: ${name}`);
    return fs.readFileSync(location);
  };
}

function gitReader(root, revision) {
  if (!SHA.test(revision)) fail('Revision must be a full commit SHA');
  git(root, ['cat-file', '-e', `${revision}^{commit}`]);
  return name => {
    relativeFile(name);
    const listing = git(root, ['ls-tree', revision, '--', name]).trim();
    if (!/^100(?:644|755) blob /.test(listing)) fail(`Missing or non-regular protected file in ${revision}: ${name}`);
    return git(root, ['show', `${revision}:${name}`], null);
  };
}

function json(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { fail(`${label}: invalid JSON`); }
}

function objects(value, label) {
  if (!Array.isArray(value) || !value.length) fail(`${label}: expected a nonempty array`);
  const result = new Map();
  for (const item of value) {
    if (!item || typeof item !== 'object' || !ID.test(item.id ?? '')) fail(`${label}: invalid ID`);
    if (result.has(item.id)) fail(`${label}: duplicate ID ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function references(values, targets, label, empty = false) {
  strings(values, label, empty);
  for (const id of values) if (!targets.has(id)) fail(`${label}: unknown reference ${id}`);
}

function validateContract(plan, read) {
  if (!plan || plan.schemaVersion !== 1) fail('plan.schemaVersion must be 1');
  text(plan.planId, 'planId');
  if (!ID.test(plan.planId)) fail('planId must use letters, digits, underscores or hyphens');
  text(plan.projectName, 'projectName');
  text(plan.repository, 'repository');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(plan.repository)) fail('repository must be OWNER/REPO without a URL');
  text(plan.completionCondition, 'completionCondition');
  if (!Number.isInteger(plan.maxParallelTasks) || plan.maxParallelTasks < 1 || plan.maxParallelTasks > 8) fail('maxParallelTasks must be an integer from 1 to 8');
  if (!Number.isInteger(plan.maxRepairAttemptsPerTask) || plan.maxRepairAttemptsPerTask < 1 || plan.maxRepairAttemptsPerTask > 10) fail('maxRepairAttemptsPerTask must be an integer from 1 to 10');
  const budget = plan.liveEvaluationBudget ?? {};
  if (!/^[A-Z]{3}$/.test(budget.currency ?? '') || typeof budget.maxSpend !== 'number' || !Number.isFinite(budget.maxSpend) || budget.maxSpend < 0) fail('liveEvaluationBudget requires a three-letter uppercase currency and a finite nonnegative maxSpend');
  strings(plan.protectedFiles, 'protectedFiles');
  for (const name of plan.protectedFiles) {
    relativeFile(name, 'protectedFiles');
    if (name === APPROVAL) fail('approval.json must not hash itself');
  }
  for (const name of REQUIRED_FILES) if (!plan.protectedFiles.includes(name)) fail(`protectedFiles is missing required file ${name}`);
  const pstack = plan.pstack ?? {};
  text(pstack.plugin, 'pstack.plugin');
  text(pstack.version, 'pstack.version');
  if (pstack.projectPlaybook !== '.agents/playbooks/futari-approved-plan.md') fail('pstack.projectPlaybook must identify the Futari approved-plan playbook');
  if (pstack.compatibilityVerified !== true) fail('Verify installed pstack compatibility before approval');
  if (!Array.isArray(plan.blockingQuestions) || plan.blockingQuestions.length) fail('Resolve blockingQuestions before approval; use an empty array once resolved');
  const permissions = plan.permissions ?? {};
  for (const key of ['createIssues', 'pushBranches', 'openPullRequests']) {
    if (permissions[key] !== true) fail(`permissions.${key} must explicitly authorize the execution workflow`);
  }
  if (!['manual', 'after-required-checks'].includes(permissions.mergePolicy)) fail('Choose permissions.mergePolicy: manual or after-required-checks');
  if (permissions.deploy !== false) fail('This starter authorizes development only; permissions.deploy must be false');
  const requirements = objects(plan.requirements, 'requirements');
  const evaluations = objects(plan.evaluations, 'evaluations');
  const tasks = objects(plan.tasks, 'tasks');
  for (const [id, item] of requirements) {
    text(item.description, `${id}.description`);
    strings(item.acceptanceCriteria, `${id}.acceptanceCriteria`);
  }
  for (const [id, item] of evaluations) {
    references(item.requirementIds, requirements, `${id}.requirementIds`);
    for (const key of ['description', 'passRule', 'command', 'kind']) text(item[key], `${id}.${key}`);
  }
  for (const [id, item] of tasks) {
    text(item.title, `${id}.title`);
    text(item.milestone, `${id}.milestone`);
    references(item.requirementIds, requirements, `${id}.requirementIds`);
    references(item.evalIds, evaluations, `${id}.evalIds`);
    references(item.dependsOn, tasks, `${id}.dependsOn`, true);
    strings(item.allowedPaths, `${id}.allowedPaths`).forEach(scopePath);
    strings(item.acceptanceCriteria, `${id}.acceptanceCriteria`);
    strings(item.verificationCommands, `${id}.verificationCommands`);
    for (const requirement of item.requirementIds) {
      if (!item.evalIds.some(e => evaluations.get(e).requirementIds.includes(requirement))) {
        fail(`${id}: no assigned evaluation covers requirement ${requirement}`);
      }
    }
  }
  for (const id of requirements.keys()) {
    if (![...evaluations.values()].some(e => e.requirementIds.includes(id))) fail(`${id}: no evaluation coverage`);
    if (![...tasks.values()].some(t => t.requirementIds.includes(id))) fail(`${id}: no task coverage`);
  }
  for (const id of evaluations.keys()) if (![...tasks.values()].some(t => t.evalIds.includes(id))) fail(`${id}: not assigned to a task`);
  const visited = new Set(), visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(`Task dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    tasks.get(id).dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);
  references(plan.verticalSliceTaskIds, tasks, 'verticalSliceTaskIds');
  const slice = new Set(plan.verticalSliceTaskIds);
  for (const id of slice) {
    for (const dep of tasks.get(id).dependsOn) if (!slice.has(dep)) fail(`Vertical slice ${id} depends on later task ${dep}`);
  }
  for (const name of plan.protectedFiles) {
    const bytes = read(name);
    if (!bytes.length) fail(`Protected file is empty: ${name}`);
    if (name.startsWith('docs/futari/') && name.endsWith('.md') && MARKER.test(bytes.toString('utf8'))) {
      fail(`Unresolved planning placeholder in ${name}`);
    }
  }
  return plan;
}

function snapshot(plan, read) {
  return Object.fromEntries(sorted(plan.protectedFiles).map(name => [name, digest(read(name))]));
}

function validateApproval(plan, approval, read, root) {
  if (!approval || approval.schemaVersion !== 1 || approval.planId !== plan.planId) fail('Approval does not match the plan');
  text(approval.approvedBy, 'approval.approvedBy');
  if (typeof approval.approvedAt !== 'string' || Number.isNaN(Date.parse(approval.approvedAt))) fail('Approval timestamp is invalid');
  if (!SHA.test(approval.planCommit ?? '')) fail('Approval planCommit is invalid');
  const files = approval.files;
  if (!files || !equal(sorted(Object.keys(files)), sorted(plan.protectedFiles)) ||
      Object.values(files).some(h => typeof h !== 'string' || !HASH.test(h))) fail('Approval file manifest is invalid');
  const canonical = Object.fromEntries(sorted(Object.keys(files)).map(name => [name, files[name]]));
  if (approval.snapshotSha256 !== digest(JSON.stringify(canonical))) fail('Approval snapshot digest is invalid');
  const current = snapshot(plan, read);
  const changed = Object.keys(canonical).filter(name => current[name] !== canonical[name]);
  if (changed.length) fail(`Approved plan drift: ${changed.join(', ')}`);
  const committed = snapshot(plan, gitReader(root, approval.planCommit));
  if (!equal(canonical, committed)) fail('Approval does not match its recorded plan commit');
  return approval;
}

function option(args, key) {
  const index = args.indexOf(key);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) fail(`Missing value for ${key}`);
  return args[index + 1];
}

function scopeMatches(filename, allowed) {
  if (allowed.endsWith('/**')) return filename.startsWith(allowed.slice(0, -2));
  if (allowed.endsWith('/')) return filename.startsWith(allowed);
  return filename === allowed;
}

export function main(args = process.argv.slice(2), cwd = process.cwd()) {
  const command = args[0] ?? 'help';
  if (command === 'help' || command === '--help') {
    console.log('Futari plan gate: check | approve --by NAME [--replace] | verify | ci --base FULL_SHA [--task TASK_ID] | status\nRun from a Git repository. approve records a decision; it does not authenticate the person. Commands in plan.json are never executed by this gate.');
    return;
  }
  if (!['check', 'approve', 'verify', 'ci', 'status'].includes(command)) fail(`Unknown command: ${command}`);
  const root = fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim());
  const read = workingReader(root);
  const load = () => validateContract(json(read(PLAN), PLAN), read);
  const approved = plan => validateApproval(plan, json(read(APPROVAL), APPROVAL), read, root);
  if (command === 'status') {
    let state = 'draft', planId = null, message = '';
    try {
      const plan = load(); planId = plan.planId; state = 'ready-for-approval';
      if (fs.existsSync(path.join(root, APPROVAL))) {
        state = 'drifted'; approved(plan); state = 'approved';
      }
    } catch (error) { message = error.message; }
    console.log(JSON.stringify({ state, planId, message }, null, 2));
    return;
  }
  if (command === 'ci') {
    const base = option(args, '--base');
    if (!SHA.test(base ?? '')) fail('ci requires --base with the full trusted base commit SHA');
    const baseRead = gitReader(root, base);
    const plan = validateContract(json(baseRead(PLAN), PLAN), baseRead);
    validateApproval(plan, json(baseRead(APPROVAL), APPROVAL), baseRead, root);
    for (const name of [...plan.protectedFiles, APPROVAL]) {
      if (!read(name).equals(baseRead(name))) fail(`Contract change requires human review and a new baseline: ${name}`);
    }
    const taskId = option(args, '--task');
    if (taskId) {
      const task = plan.tasks.find(t => t.id === taskId);
      if (!task) fail(`Unknown approved task: ${taskId}`);
      const changed = git(root, ['diff', '--name-only', '-z', '--no-renames', `${base}...HEAD`, '--']).split('\0').filter(Boolean);
      const operational = [`.futari/evidence/${taskId}.md`, 'docs/futari/PROGRESS.md'];
      const outside = changed.filter(name => !operational.includes(name) && !task.allowedPaths.some(p => scopeMatches(name, p)));
      if (outside.length) fail(`Changes outside ${taskId}.allowedPaths: ${outside.join(', ')}`);
      console.log(`PASS ${plan.planId}: approved contract unchanged; ${taskId} file scope checked (${changed.length} changed files).`);
    } else console.log(`PASS ${plan.planId}: approved contract unchanged (task scope was not requested).`);
    return;
  }
  const plan = load();
  if (command === 'check') {
    console.log(`PASS ${plan.planId}: readiness, traceability, dependency graph and protected files checked. Product tests/evals have not been run by this command.`);
  } else if (command === 'verify') {
    const approval = approved(plan);
    console.log(`PASS ${plan.planId}: approved snapshot ${approval.snapshotSha256} matches ${approval.planCommit}.`);
  } else if (command === 'approve') {
    const by = text(option(args, '--by'), '--by');
    const approvalPath = path.join(root, APPROVAL);
    if (fs.existsSync(approvalPath)) {
      if (fs.lstatSync(approvalPath).isSymbolicLink()) fail('Approval path must not be a symlink');
      if (!args.includes('--replace')) fail('Approval already exists. A reviewed baseline change requires explicit --replace.');
    }
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    const committed = gitReader(root, head);
    for (const name of plan.protectedFiles) {
      if (!read(name).equals(committed(name))) fail(`Commit the reviewed protected file before approval: ${name}`);
    }
    const files = snapshot(plan, read);
    const approval = { schemaVersion: 1, planId: plan.planId, approvedBy: by,
      approvedAt: new Date().toISOString(), planCommit: head, files,
      snapshotSha256: digest(JSON.stringify(files)) };
    const temporary = `${approvalPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(approval, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, approvalPath);
    console.log(`APPROVED ${plan.planId} by ${by}. Snapshot ${approval.snapshotSha256}.\nCommit .futari/approval.json before starting issue execution. This records the supplied name; it is not an identity signature.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`FUTARI GATE: ${error.message}`); process.exitCode = 1; }
}
