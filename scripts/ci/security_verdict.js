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
      report += '\n### 🔬 Pattern Scan\n' + decodeURIComponent(rawFindings);
    } catch {
      report += '\n### 🔬 Pattern Scan\n' + rawFindings;
    }
  }

  if (gitleaksOutcome === 'failure') {
    clean = false;
    report += '\n### 🔑 Secret Leak Detection\n🚨 Leaked credentials or keys detected.';
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
