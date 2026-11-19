/**
 * PR Security Gate Decision & Enforcement Module
 * Validates PR against compliance requirements and enforces auto-close only on malicious/security violations.
 * If PR is malware-free but has compliance/scope issues, leaves PR open and provides actionable contributor guidance.
 */
module.exports = async ({ github, context, core }) => {
  const pr = context.payload.pull_request;
  const prNumber = pr.number;
  const prAuthor = pr.user.login;

  const issueCompliant = process.env.ISSUE_COMPLIANT === 'true';
  const scanClean = process.env.SCAN_CLEAN === 'true';
  const issueReason = process.env.ISSUE_REASON || '';
  const rawScanReport = process.env.SCAN_REPORT || '';
  const scanReport = rawScanReport.trim() !== '' ? rawScanReport : '🚨 Security scan flagged an unverified anomaly or secret leak.';
  const linkedIssue = process.env.LINKED_ISSUE || '';
  const issueTitle = process.env.ISSUE_TITLE || '';
  const scopeReport = process.env.SCOPE_REPORT || '';
  const timestamp = new Date().toISOString();

  // Trusted automated actors & maintainers
  const isMaintainerPR = prAuthor.toLowerCase() === context.repo.owner.toLowerCase() || prAuthor.toLowerCase() === 'emarkees';
  const isDependabot = prAuthor.toLowerCase() === 'dependabot[bot]' || prAuthor.toLowerCase() === 'dependabot';
  const isReleaseSync = pr.head.ref === 'develop' && pr.base.ref === 'main';

  // NEVER auto-close Dependabot, Maintainer, or Release Sync PRs
  if (isDependabot || isMaintainerPR || isReleaseSync) {
    const actorName = isDependabot ? 'Dependabot' : (isReleaseSync ? 'Release Sync' : 'Maintainer');
    console.log(`✅ ${actorName} PR verified for @${prAuthor}. Security gate automatically approved.`);

    let body = `## 🛡️ PR Security Gate — APPROVED (${actorName}) ✅\n\n`;
    body += `**PR:** #${prNumber} by @${prAuthor}\n`;
    body += `**Time:** ${timestamp}\n\n`;
    body += `---\n\n`;
    body += `### 🔍 Automated Verification Results:\n`;
    body += `- ✅ **Trusted Entity:** Verified official ${actorName} pull request.\n`;
    body += `- ✅ **Scope Check:** Authorized automated dependency/infrastructure update.\n`;
    body += `\n> 🚀 **Ready for automated merge or maintainer review.**\n`;

    try {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: body,
      });
    } catch (e) {
      console.log(`Notice: Could not post comment to PR #${prNumber}: ${e.message}`);
    }

    try {
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        labels: ['security-passed'],
      });
    } catch {}

    return;
  }

  // CASE 1: CRITICAL MALWARE, SECRET LEAK, OR THREAT DETECTED -> REJECT & AUTO-CLOSE
  if (!scanClean) {
    let body = `## 🚨 PR Security Gate — SECURITY THREAT DETECTED (CLOSED)\n\n`;
    body += `**PR:** #${prNumber} by @${prAuthor}\n`;
    body += `**Time:** ${timestamp}\n\n`;
    body += `---\n\n`;
    body += `### 🔬 Security Threat Findings\n${scanReport}\n\n`;
    body += `---\n`;
    body += `> ⛔ **This PR has been automatically closed** to defend the repository against malicious code, leaked secrets, or dangerous binaries.\n`;
    body += `> If you believe this is a false positive, please reach out directly to maintainer @emarkees.\n`;

    try {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: body,
      });
    } catch (commentErr) {
      console.error(`⚠️ Could not post comment to PR #${prNumber}: ${commentErr.message}`);
    }

    try {
      await github.rest.pulls.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: prNumber,
        state: 'closed',
      });
    } catch (closeErr) {
      console.error(`⚠️ Could not auto-close PR #${prNumber}: ${closeErr.message}`);
    }

    try {
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        labels: ['security-rejected'],
      });
    } catch (labelErr) {
      console.error(`⚠️ Could not add label to PR #${prNumber}: ${labelErr.message}`);
    }

    core.setFailed(`PR #${prNumber} rejected and auto-closed due to malicious code or secret leak detection.`);
    return;
  }

  // CASE 2: CLEAN CODE (NO MALWARE/VIRUS), BUT COMPLIANCE / SCOPE ISSUE -> KEEP OPEN & ADVISE
  if (!issueCompliant) {
    let body = `## ⚠️ PR Compliance Check — Action Required (Pending Corrections)\n\n`;
    body += `**PR:** #${prNumber} by @${prAuthor}\n`;
    body += `**Time:** ${timestamp}\n\n`;
    body += `---\n\n`;
    body += `### 🛡️ Malware & Security Scan: PASSED ✅\n`;
    body += `- ✅ **No malware, viruses, reverse shells, or mining code detected.**\n`;
    body += `- ✅ **No leaked private keys (Stellar S-keys) or secret credentials detected.**\n`;
    body += `- ✅ **No dangerous binary droppers detected.**\n\n`;
    body += `---\n\n`;
    body += `### 📋 What Needs to be Resolved:\n`;
    body += `${issueReason}\n\n`;
    body += `---\n\n`;
    body += `### 💡 Contributor Guidance — Where and How to Resolve:\n\n`;
    body += `1. **Linking Issues (Maximum 4 per PR):**\n`;
    body += `   - Ensure your PR description references the approved issue(s) using GitHub keywords: e.g., \`Closes #42\` or \`Closes #10, #11\`.\n`;
    body += `   - Contributors may bundle up to a **maximum of 4 issues per PR** to earn sprint points. If you worked on more than 4 issues, please split them into separate pull requests.\n\n`;
    body += `2. **Issue Assignment & Availability:**\n`;
    body += `   - You must be officially assigned to each claimed issue by a maintainer before submitting a PR.\n`;
    body += `   - Browse available tasks: [Open Issues Catalog](https://github.com/${context.repo.owner}/${context.repo.repo}/issues?q=is%3Aissue+is%3Aopen+label%3Adrips-wave).\n`;
    body += `   - Consult the sprint guide: [\`docs/STELLAR_DRIPS_WAVE_PLAYBOOK.md\`](https://github.com/${context.repo.owner}/${context.repo.repo}/blob/develop/docs/STELLAR_DRIPS_WAVE_PLAYBOOK.md).\n`;
    body += `   - Comment on the issue asking to be assigned before opening the PR.\n\n`;
    body += `3. **Architectural Scope Alignment:**\n`;
    body += `   - Keep changes scoped to your assigned layer:\n`;
    body += `     - Smart Contracts: \`contracts/\`\n`;
    body += `     - Frontend Web App: \`apps/web/\`\n`;
    body += `     - Contract Client SDK: \`packages/contract-client/\`\n`;
    body += `     - Go Relay Daemon: \`services/relay/\`\n`;
    body += `     - Documentation & Evidence: \`docs/\`, \`evidence/\`\n`;
    body += `   - **Do not modify** \`.github/\` or \`scripts/ci/\`. If unauthorized files were touched, revert them locally:\n`;
    body += `     \`git checkout origin/develop -- <filepath>\`\n`;
    body += `     \`git commit -m "revert unauthorized changes"\`\n`;
    body += `     \`git push\`\n\n`;
    body += `4. **Next Steps:**\n`;
    body += `   - 🔄 **Your PR remains OPEN.** Once you update your PR description or push fixes, this check will re-run automatically!\n`;

    try {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: body,
      });
    } catch (commentErr) {
      console.error(`⚠️ Could not post comment to PR #${prNumber}: ${commentErr.message}`);
    }

    try {
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        labels: ['needs-compliance'],
      });
    } catch (labelErr) {
      console.error(`⚠️ Could not add label to PR #${prNumber}: ${labelErr.message}`);
    }

    try {
      await github.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        name: 'security-rejected',
      });
    } catch {}

    try {
      await github.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        name: 'security-passed',
      });
    } catch {}

    core.setFailed(`PR #${prNumber} requires compliance updates before merge. See instructions in PR comment.`);
    return;
  }

  // CASE 3: ALL CHECKS PASSED (CLEAN SCAN + COMPLIANT)
  let body = `## 🛡️ PR Security Gate — PASSED ✅\n\n`;
  body += `**PR:** #${prNumber} by @${prAuthor}\n`;
  body += `**Verified Linked Issue(s):** ${linkedIssue}\n`;
  if (issueTitle) {
    body += `**Issue Details:** ${issueTitle}\n`;
  }
  body += `**Time:** ${timestamp}\n\n`;
  body += `---\n\n`;
  body += `### 🔍 Automated Verification Results:\n`;
  body += `- ✅ **Approved Assignment:** Verified @${prAuthor} is approved assignee for ${linkedIssue}.\n`;
  body += `- ✅ **Scope Check:** ${scopeReport}\n`;
  body += `- ✅ **Malware Scan:** Clean (no reverse shells, miners, keyloggers, exfiltration).\n`;
  body += `- ✅ **Secret Leak Scan:** Clean (no Stellar S-keys or credentials).\n`;
  body += `- ✅ **Integrity:** No unauthorized binary droppers or CI modifications.\n\n`;
  body += `> ⏳ **Ready for maintainer manual review** (@emarkees). Continuous Integration tests can proceed.`;

  try {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: body,
    });
  } catch (commentErr) {
    console.error(`⚠️ Could not post comment to PR #${prNumber}: ${commentErr.message}`);
  }

  try {
    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      labels: ['security-passed'],
    });
  } catch (labelErr) {
    console.error(`⚠️ Could not add label to PR #${prNumber}: ${labelErr.message}`);
  }

  try {
    await github.rest.issues.removeLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      name: 'needs-compliance',
    });
  } catch {}

  try {
    await github.rest.issues.removeLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      name: 'security-rejected',
    });
  } catch {}

  console.log(`✅ PR #${prNumber} passed security gate.`);
};
