/**
 * Stub for n8n-core — provides minimal exports so n8n-nodes-base can load
 * without pulling in the full n8n-core dependency tree.
 *
 * Only 2 exports are actually used at load-time:
 * - getWebhookSandboxCSP (sendAndWait/utils.js, Form/utils/utils.js)
 * - ErrorReporter (Merge/v3/actions/mode/combineBySql.js)
 */

module.exports = {
  getWebhookSandboxCSP() {
    return "";
  },

  ErrorReporter: {
    error() {},
    warn() {},
    info() {},
  },
};
