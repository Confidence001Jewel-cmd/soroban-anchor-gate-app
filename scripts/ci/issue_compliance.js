/**
 * Issue Compliance and Architectural Scope Verification Module
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

  // Step 1: Extract issue references
  const issuePatterns = [
    /(?:closes|fixes|resolves)\s+#(\d+)/gi,
    /(?:close|fix|resolve)\s+#(\d+)/gi,
    /\bLinked Issue:\s*(?:Closes\s+)?#(\d+)/gi,
  ];

  const issueNumbers = new Set();
  for (const pattern of issuePatterns) {
    let match;
    while ((match = pattern.exec(prBody)) !== null) {
      issueNumbers.add(parseInt(match[1]));
    }
    pattern.lastIndex = 0;
    while ((match = pattern.exec(prTitle)) !== null) {
      issueNumbers.add(parseInt(match[1]));
    }
  }

  const branchMatch = branchName.match(/^wave\/(\d+)/);
  if (branchMatch) {
    issueNumbers.add(parseInt(branchMatch[1]));
  }

  if (issueNumbers.size === 0) {
    core.setOutput('is_compliant', 'false');
    core.setOutput('linked_issue', '');
    core.setOutput('failure_reason',
      '❌ **No linked issue found.** Your PR must reference an approved GitHub issue ' +
      '(e.g., `Closes #42` in description) and branch must follow `wave/<issue-number>-<short-description>`.');
    return;
  }

  // Step 2: Validate Issue Assignment
  let validIssue = null;
  let issueData = null;
  const errors = [];

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
        errors.push(`#${issueNum} is closed. Contributions for closed issues are rejected.`);
        continue;
      }

      const assignees = iss.assignees.map(a => a.login.toLowerCase());
      if (!assignees.includes(prAuthor.toLowerCase())) {
        errors.push(
          `#${issueNum} is not assigned to @${prAuthor}. ` +
          `Assigned to: ${assignees.length ? assignees.map(a => '@' + a).join(', ') : 'none'}. ` +
          `You must be approved & assigned to the issue before working on it.`
        );
        continue;
      }

      validIssue = issueNum;
      issueData = iss;
      break;
    } catch (err) {
      errors.push(`Issue #${issueNum} query failed: ${err.message}`);
    }
  }

  if (!validIssue || !issueData) {
    core.setOutput('is_compliant', 'false');
    core.setOutput('linked_issue', '');
    core.setOutput('failure_reason', '❌ **Issue compliance check failed:**\n' + errors.map(e => `- ${e}`).join('\n'));
    return;
  }

  // Step 3: Branch naming check
  const branchRegex = /^wave\/\d+-[\w-]+$/;
  let branchNotice = '';
  if (!branchRegex.test(branchName)) {
    branchNotice = `\n⚠️ **Branch naming notice:** Branch \`${branchName}\` does not strictly follow \`wave/<issue>-<short-description>\`.`;
  }

  // Step 4: Issue Scope Extraction
  const issueBody = issueData.body || '';
  const issueTitle = issueData.title || '';

  let targetLayer = 'all';
  if (issueBody.includes('Smart Contracts (contracts/)')) targetLayer = 'contracts';
  else if (issueBody.includes('Frontend Web App (apps/web/)')) targetLayer = 'web';
  else if (issueBody.includes('Contract Client SDK (packages/contract-client/)')) targetLayer = 'sdk';
  else if (issueBody.includes('Relay Daemon (services/relay/)')) targetLayer = 'relay';
  else if (issueBody.includes('Documentation & Evidence (docs/, evidence/)')) targetLayer = 'docs';

  // Step 5: Check PR Changed Files
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
    if (path.startsWith('.github/workflows/') || path.startsWith('.github/CODEOWNERS')) {
      if (targetLayer !== 'all' && !issueTitle.toLowerCase().includes('ci') && !issueTitle.toLowerCase().includes('workflow')) {
        forbiddenFiles.push(path);
      }
    }

    if (targetLayer === 'contracts') {
      if (!path.startsWith('contracts/') && !path.startsWith('evidence/') && !path.endsWith('.md')) {
        outOfScopeFiles.push(path);
      }
    } else if (targetLayer === 'web') {
      if (!path.startsWith('apps/web/') && !path.endsWith('.md')) {
        outOfScopeFiles.push(path);
      }
    } else if (targetLayer === 'sdk') {
      if (!path.startsWith('packages/contract-client/') && !path.endsWith('.md')) {
        outOfScopeFiles.push(path);
      }
    } else if (targetLayer === 'relay') {
      if (!path.startsWith('services/relay/') && !path.endsWith('.md')) {
        outOfScopeFiles.push(path);
      }
    } else if (targetLayer === 'docs') {
      if (!path.endsWith('.md') && !path.startsWith('docs/') && !path.startsWith('evidence/')) {
        outOfScopeFiles.push(path);
      }
    }
  }

  if (forbiddenFiles.length > 0) {
    core.setOutput('is_compliant', 'false');
    core.setOutput('linked_issue', String(validIssue));
    core.setOutput('failure_reason',
      `🚨 **Critical Scope Violation:** PR modifies repository infrastructure / security files not authorized by issue #${validIssue}:\n` +
      forbiddenFiles.map(f => `- \`${f}\``).join('\n'));
    return;
  }

  let scopeReport = `Target layer verified: **${targetLayer}**. ${changedPaths.length} files changed.`;
  if (outOfScopeFiles.length > 0) {
    scopeReport += `\n⚠️ **Notice (Potential scope creep):** The following files are outside the target layer \`${targetLayer}\`:\n` +
      outOfScopeFiles.slice(0, 10).map(f => `- \`${f}\``).join('\n');
  }

  core.setOutput('is_compliant', 'true');
  core.setOutput('linked_issue', String(validIssue));
  core.setOutput('issue_title', issueTitle);
  core.setOutput('issue_layer', targetLayer);
  core.setOutput('scope_report', scopeReport);
  core.setOutput('failure_reason', branchNotice);
};
