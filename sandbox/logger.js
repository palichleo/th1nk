const DEBUG_ENABLED = /^(1|true|yes)$/i.test(process.env.TH1NK_DEBUG || "");

function debugLog(...args) {
  if (DEBUG_ENABLED) {
    console.log(...args);
  }
}

function errorLog(...args) {
  console.error(...args);
}

module.exports = {
  debugLog,
  errorLog
};
