/**
 * PR Security Gate Decision & Enforcement Module
 * Validates PR against compliance requirements and enforces auto-close on violations.
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

  if (!issueCompliant || !scanClean) {
    let body = `## 🚨 PR Security Gate — REJECTED & CLOSED\n\n`;
    body += `**PR:** #${prNumber} by @${prAuthor}\n`;
    body += `**Time:** ${timestamp}\n\n`;
    body += `---\n\n`;

    if (!issueCompliant) {
      body += `### 📋 Issue & Scope Compliance Failure\n${issueReason}\n\n`;
    }
    if (!scanClean) {
      body += `### 🔬 Security Threat Findings\n${scanReport}\n\n`;
    }

    body += `---\n`;
    body += `> ⛔ **This PR has been automatically closed** to defend the repository against unauthorized, out-of-scope, or malicious additions.\n`;
    body += `> If you believe this is an error, please reach out directly to the maintainer @emarkees.\n`;

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

    core.setFailed(`PR #${prNumber} rejected and auto-closed due to security/compliance violations.`);
  } else {
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

    console.log(`✅ PR #${prNumber} passed security gate.`);
  }
};
