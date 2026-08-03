"use strict";

const crypto = require("crypto");

function isProductionEnvironment(environment = process.env) {
  return (
    environment.NODE_ENV === "production" ||
    Boolean((environment.WEBSITE_SITE_NAME || "").trim())
  );
}

function resolveSessionSecret(environment = process.env) {
  const configuredSecret = (
    environment.SESSION_SECRET ||
    environment.FLASK_SECRET_KEY ||
    ""
  ).trim();

  if (isProductionEnvironment(environment) && configuredSecret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be configured with at least 32 characters in production.",
    );
  }

  return {
    configuredSecret,
    sessionSecret:
      configuredSecret || crypto.randomBytes(32).toString("hex"),
  };
}

module.exports = { isProductionEnvironment, resolveSessionSecret };
