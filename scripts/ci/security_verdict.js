const fs = require('fs');

/**
 * Security Verdict Evaluation Module
 * Processes scanner outputs from environment variables without exposing logic in workflow runners.
 */
module.exports = async ({ core }) => {
  const patternClean = process.env.PATTERN_CLEAN === 'true';
  const gitleaksOutcome = process.env.GITLEAKS_OUTCOME || 'success';
  const fileClean = process.env.FILE_CLEAN === 'true';

  let clean = true;
  let report = '';

  if (!patternClean) {
    clean = false;
    const rawFindings = process.env.PATTERN_FINDINGS || '';
    try {
      report += '\n### 🔬 Pattern Scan Anomalies\n' + decodeURIComponent(rawFindings);
    } catch {
      report += '\n### 🔬 Pattern Scan Anomalies\n' + rawFindings;
    }
  }

  if (gitleaksOutcome === 'failure') {
    clean = false;
    let leakDetails = '';
    const reportPath = 'gitleaks-report.json';
    if (fs.existsSync(reportPath)) {
      try {
        const raw = fs.readFileSync(reportPath, 'utf8');
        const leaks = JSON.parse(raw);
        if (Array.isArray(leaks) && leaks.length > 0) {
          leakDetails = '\n' + leaks.slice(0, 10).map(l =>
            `- 🚨 **${l.RuleID || l.Description || 'Potential Secret'}** detected in \`${l.File}:${l.StartLine || '?'}\``
          ).join('\n');
          if (leaks.length > 10) {
            leakDetails += `\n...and ${leaks.length - 10} more finding(s)`;
          }
        }
      } catch (e) {
        console.error('Error parsing gitleaks report:', e);
      }
    }

    if (leakDetails) {
      report += '\n### 🔑 Secret Leak Detection\n' + leakDetails;
    } else {
      report += '\n### 🔑 Secret Leak Detection\n' +
        '🚨 Leaked credentials, API tokens, or private keys detected in your PR changes or commit history.';
    }
  }

  if (!fileClean) {
    clean = false;
    const rawFileFindings = process.env.FILE_FINDINGS || '';
    try {
      report += '\n### 📄 Binary/Payload Anomalies\n' + decodeURIComponent(rawFileFindings);
    } catch {
      report += '\n### 📄 Binary/Payload Anomalies\n' + rawFileFindings;
    }
  }

  core.setOutput('is_clean', clean ? 'true' : 'false');
  core.setOutput('scan_report', clean ? '✅ All security inspection layers passed clean.' : report);
};
