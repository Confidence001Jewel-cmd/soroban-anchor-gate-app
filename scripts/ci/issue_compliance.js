/**
 * Issue Compliance and Architectural Scope Verification Module
 * Validates PR against linked issues, author assignment, issue capacity (max 4),
 * and architectural layer scope integrity.
 */
module.exports = async ({ github, context, core }) => {
  const pr = context.payload.pull_request;
  const prAuthor = pr.user.login;
  const prBody = pr.body || '';
  const prTitle = pr.title || '';
  const branchName = pr.head.ref || '';

  console.log(`Checking PR #${pr.number} by @${prAuthor} (branch: ${branchName})`);

  // Maintainer / Release / Dependabot Bypass
  const isMaintainer = prAuthor.toLowerCase() === context.repo.owner.toLowerCase() || prAuthor.toLowerCase() === 'emarkees';
  const isDependabot = prAuthor.toLowerCase() === 'dependabot[bot]' || prAuthor.toLowerCase() === 'dependabot';
  const isReleasePR = branchName === 'develop' && pr.base.ref === 'main';

  if (isMaintainer || isReleasePR || isDependabot) {
    const roleName = isDependabot ? 'Dependabot' : (isReleasePR ? 'Release Sync' : 'Maintainer');
    console.log(`${roleName} PR verified for @${prAuthor}.`);
    core.setOutput('is_compliant', 'true');
    core.setOutput('linked_issue', isDependabot ? 'automated-deps' : (isReleasePR ? 'release-sync' : 'maintainer-branch'));
    core.setOutput('issue_title', isDependabot ? 'Dependabot Dependency Update' : (isReleasePR ? 'Release Sync: develop -> main' : 'Maintainer Direct Update'));
    core.setOutput('issue_layer', 'all');
    core.setOutput('scope_report', `${roleName} PR: verified automated/trusted scope.`);
    core.setOutput('failure_reason', '');
    return;
  }

  // Step 1: Extract all issue references (supports single, comma, 'and' separated, max 4)
  const issueNumbers = new Set();

  // Pattern A: Comma or 'and' separated lists e.g. "Closes #120, #121 and #122" or "Fixes #1, Fixes #2"
  const multiIssueRegex = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(#[0-9]+(?:\s*(?:,|and|\s)\s*#[0-9]+)*)/gi;
  let match;
  while ((match = multiIssueRegex.exec(prBody)) !== null) {
    const nums = match[1].match(/\d+/g);
    if (nums) nums.forEach(n => issueNumbers.add(parseInt(n, 10)));
  }
  while ((match = multiIssueRegex.exec(prTitle)) !== null) {
    const nums = match[1].match(/\d+/g);
    if (nums) nums.forEach(n => issueNumbers.add(parseInt(n, 10)));
  }

  // Pattern B: Standard individual keywords: "Closes #123", "Fixes: #123"
  const singleRegex = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi;
  while ((match = singleRegex.exec(prBody)) !== null) {
    issueNumbers.add(parseInt(match[1], 10));
  }
  while ((match = singleRegex.exec(prTitle)) !== null) {
    issueNumbers.add(parseInt(match[1], 10));
  }

  // Pattern C: Full issue URLs: "Closes https://github.com/Sorobo-Gate/soroban-anchor-gate-app/issues/123"
  const urlRegex = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/gi;
  while ((match = urlRegex.exec(prBody)) !== null) {
    issueNumbers.add(parseInt(match[1], 10));
  }

  // Pattern D: "Linked Issue: #42" or "Linked Issues: #42, #43"
  const linkedRegex = /Linked\s+Issue[s]?\s*:\s*(?:(?:Closes|Fixes|Resolves)\s*)?(#[0-9]+(?:\s*(?:,|and|\s)\s*#[0-9]+)*)/gi;
  while ((match = linkedRegex.exec(prBody)) !== null) {
    const nums = match[1].match(/\d+/g);
    if (nums) nums.forEach(n => issueNumbers.add(parseInt(n, 10)));
  }

  // Pattern E: Branch names like wave/120 or feat/issues-120-123
  const branchWave = branchName.match(/^wave\/(\d+)/);
  if (branchWave) {
    issueNumbers.add(parseInt(branchWave[1], 10));
  }
  const branchFeat = branchName.match(/(?:issue|wave)s?[-/](\d+)(?:[-_](\d+))?/i);
  if (branchFeat) {
    if (branchFeat[1]) issueNumbers.add(parseInt(branchFeat[1], 10));
    if (branchFeat[2]) issueNumbers.add(parseInt(branchFeat[2], 10));
  }

  // Validation: Check if at least 1 issue was linked
  if (issueNumbers.size === 0) {
    core.setOutput('is_compliant', 'false');
    core.setOutput('linked_issue', '');
    core.setOutput('failure_reason',
      '❌ **No linked issue found.** Your PR must reference an approved GitHub issue ' +
      '(e.g., `Closes #42` in description) and branch must follow `wave/<issue-number>-<short-description>`.');
    return;
  }

  // Validation: Enforce max 4 issues per PR to preserve security integrity & review depth
  if (issueNumbers.size > 4) {
    const foundList = Array.from(issueNumbers).map(n => `#${n}`).join(', ');
    core.setOutput('is_compliant', 'false');
    core.setOutput('linked_issue', foundList);
    core.setOutput('failure_reason',
      `❌ **Issue Capacity Exceeded (${issueNumbers.size} issues found: ${foundList}):**\n` +
      `To maintain security integrity, prevent review fatigue, and verify that changes are thoroughly tested, ` +
      `a single pull request may close a **maximum of 4 issues**.\n\n` +
      `👉 Please split your work into smaller, focused pull requests (max 4 issues each).`);
    return;
  }

  // Step 2: Validate Issue Assignment & Status for EVERY claimed issue
  const validIssues = [];
  const verifiedIssueDetails = [];
  const errors = [];
  const allowedLayers = new Set();

  for (const issueNum of issueNumbers) {
    try {
      const res = await github.rest.issues.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNum,
      });
      const iss = res.data;

      if (iss.pull_request) {
        errors.push(`#${issueNum} is a pull request, not an issue.`);
        continue;
      }

      if (iss.state !== 'open') {
        errors.push(`#${issueNum} is closed. Work cannot be submitted for already closed issues.`);
        continue;
      }

      const assignees = (iss.assignees || []).map(a => a.login.toLowerCase());
      if (!assignees.includes(prAuthor.toLowerCase())) {
        errors.push(
          `#${issueNum} is not assigned to @${prAuthor}. ` +
          `Assigned to: ${assignees.length ? assignees.map(a => '@' + a).join(', ') : 'none'}. ` +
          `You must be approved and assigned by maintainers before submitting work.`
        );
        continue;
      }

      validIssues.push(issueNum);
      verifiedIssueDetails.push(iss);

      const issueBody = iss.body || '';
      const issueTitle = iss.title || '';

      let layerDetected = false;
      if (issueBody.includes('Smart Contracts (contracts/)') || issueTitle.toLowerCase().includes('contract')) {
        allowedLayers.add('contracts');
        layerDetected = true;
      }
      if (issueBody.includes('Frontend Web App (apps/web/)') || issueTitle.toLowerCase().includes('frontend') || issueTitle.toLowerCase().includes('ui')) {
        allowedLayers.add('web');
        layerDetected = true;
      }
      if (issueBody.includes('Contract Client SDK (packages/contract-client/)') || issueTitle.toLowerCase().includes('sdk')) {
        allowedLayers.add('sdk');
        layerDetected = true;
      }
      if (issueBody.includes('Relay Daemon (services/relay/)') || issueTitle.toLowerCase().includes('relay')) {
        allowedLayers.add('relay');
        layerDetected = true;
      }
      if (issueBody.includes('Documentation & Evidence (docs/, evidence/)') || issueTitle.toLowerCase().includes('doc') || issueTitle.toLowerCase().includes('evidence')) {
        allowedLayers.add('docs');
        layerDetected = true;
      }

      if (!layerDetected) {
        allowedLayers.add('all');
      }
    } catch (err) {
      errors.push(`Issue #${issueNum} query failed: ${err.message}`);
    }
  }

  // If ANY linked issue failed assignment or is closed, fail the whole PR
  if (errors.length > 0 || validIssues.length !== issueNumbers.size) {
    const listStr = Array.from(issueNumbers).map(n => `#${n}`).join(', ');
    core.setOutput('is_compliant', 'false');
    core.setOutput('linked_issue', listStr);
    core.setOutput('failure_reason',
      `❌ **Issue verification failed for [${listStr}]:**\n` +
      errors.map(e => `- ${e}`).join('\n') +
      '\n\n> 🛡️ **Integrity Rule:** Every claimed issue must be open, existing, and officially assigned to you.'
    );
    return;
  }

  // Step 3: Branch naming check (informational notice)
  const branchRegex = /^(?:wave\/\d+-[\w-]+|feat\/[\w-]+)$/i;
  let branchNotice = '';
  if (!branchRegex.test(branchName)) {
    branchNotice = `\n⚠️ **Branch naming notice:** Branch \`${branchName}\` does not follow recommended \`wave/<issue>-<description>\` pattern.`;
  }

  // Step 4: Check PR Changed Files against combined architectural scope
  const prFiles = await github.paginate(github.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pr.number,
    per_page: 100,
  });

  const changedPaths = prFiles.map(f => f.filename);
  const forbiddenFiles = [];
  const outOfScopeFiles = [];

  for (const path of changedPaths) {
    // STRICT RULE: Contributors must NEVER modify CI workflows, security gate files, or CODEOWNERS
    if (path.startsWith('.github/') || path.startsWith('scripts/ci/')) {
      forbiddenFiles.push(path);
      continue;
    }

    if (allowedLayers.has('all')) {
      continue;
    }

    let inScope = false;
    if (allowedLayers.has('contracts') && (path.startsWith('contracts/') || path.startsWith('evidence/') || path.endsWith('.md'))) {
      inScope = true;
    }
    if (allowedLayers.has('web') && (path.startsWith('apps/web/') || path.endsWith('.md'))) {
      inScope = true;
    }
    if (allowedLayers.has('sdk') && (path.startsWith('packages/contract-client/') || path.endsWith('.md'))) {
      inScope = true;
    }
    if (allowedLayers.has('relay') && (path.startsWith('services/relay/') || path.endsWith('.md'))) {
      inScope = true;
    }
    if (allowedLayers.has('docs') && (path.endsWith('.md') || path.startsWith('docs/') || path.startsWith('evidence/'))) {
      inScope = true;
    }

    if (!inScope) {
      outOfScopeFiles.push(path);
    }
  }

  if (forbiddenFiles.length > 0) {
    core.setOutput('is_compliant', 'false');
    core.setOutput('linked_issue', validIssues.map(n => `#${n}`).join(', '));
    core.setOutput('failure_reason',
      `🚨 **Critical Security Violation:** PR modifies repository infrastructure, CI workflows, or security gate files:\n` +
      forbiddenFiles.map(f => `- \`${f}\``).join('\n') +
      `\n\n> 🛡️ Modifying CI workflows or security verification scripts is strictly reserved for repository maintainers.`);
    return;
  }

  const layerList = Array.from(allowedLayers).join(', ');
  let scopeReport = `Verified **${validIssues.length}** issue(s): ${validIssues.map(n => '#' + n).join(', ')}.\n` +
    `- **Authorized Architecture Layer(s):** \`${layerList}\`\n` +
    `- **Total Changed Files:** ${changedPaths.length}`;

  if (outOfScopeFiles.length > 0) {
    scopeReport += `\n⚠️ **Notice (Potential scope creep):** Files outside designated layers [\`${layerList}\`]:\n` +
      outOfScopeFiles.slice(0, 10).map(f => `- \`${f}\``).join('\n');
  }

  core.setOutput('is_compliant', 'true');
  core.setOutput('linked_issue', validIssues.map(n => `#${n}`).join(', '));
  core.setOutput('issue_title', verifiedIssueDetails.map(iss => `#${iss.number}: ${iss.title}`).join(' | '));
  core.setOutput('issue_layer', layerList);
  core.setOutput('scope_report', scopeReport);
  core.setOutput('failure_reason', branchNotice);
};
