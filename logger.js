"use strict";

function serializeError(error) {
  if (!error) {
    return undefined;
  }
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
  };
}

function writeLog(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: process.env.WEBSITE_SITE_NAME || "web-ccoedemo-node",
    ...fields,
  };

  if (entry.error instanceof Error) {
    entry.error = serializeError(entry.error);
  }

  const output = JSON.stringify(entry);
  if (level === "error") {
    console.error(output);
  } else {
    console.log(output);
  }
}

module.exports = {
  error(event, fields) {
    writeLog("error", event, fields);
  },
  info(event, fields) {
    writeLog("info", event, fields);
  },
  warn(event, fields) {
    writeLog("warn", event, fields);
  },
};
