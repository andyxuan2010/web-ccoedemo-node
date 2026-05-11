const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const nunjucks = require("nunjucks");
const { ConfidentialClientApplication } = require("@azure/msal-node");

require("dotenv").config();

const app = express();
app.set("trust proxy", 1);

function parseSubscriptionId(ownerName) {
  const trimmedOwnerName = (ownerName || "").trim();
  if (!trimmedOwnerName) {
    return "";
  }
  const [subscriptionId] = trimmedOwnerName.split("+", 1);
  return subscriptionId.trim();
}

const config = {
  aadClientId: process.env.AAD_CLIENT_ID || "",
  aadClientSecret: process.env.AAD_CLIENT_SECRET || "",
  aadTenantId: process.env.AAD_TENANT_ID || "common",
  aadRedirectPath: process.env.AAD_REDIRECT_PATH || "/auth/callback",
  aadRedirectUri: process.env.AAD_REDIRECT_URI || "",
  aadPostLogoutRedirectUri: process.env.AAD_POST_LOGOUT_REDIRECT_URI || "",
  easyAuthLoginPath: process.env.EASY_AUTH_LOGIN_PATH || "/.auth/login/aad",
  easyAuthLogoutPath: process.env.EASY_AUTH_LOGOUT_PATH || "/.auth/logout",
  appServicePortalUrl: process.env.APP_SERVICE_PORTAL_URL || "",
  appRegistrationPortalUrl: process.env.APP_REGISTRATION_PORTAL_URL || "",
  appServiceName: process.env.WEBSITE_SITE_NAME || process.env.APP_SERVICE_NAME || "",
  appServiceSubscriptionId:
    parseSubscriptionId(process.env.WEBSITE_OWNER_NAME) ||
    process.env.APP_SERVICE_SUBSCRIPTION_ID ||
    process.env.ARM_SUBSCRIPTION_ID ||
    "",
  appServiceResourceGroup:
    process.env.WEBSITE_RESOURCE_GROUP ||
    process.env.APP_SERVICE_RESOURCE_GROUP ||
    "",
  aadScopes: (process.env.AAD_SCOPES || "User.Read")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean),
};

const siteName = process.env.WEBSITE_SITE_NAME || "local-demo";
const configuredSecret = (process.env.SESSION_SECRET || process.env.FLASK_SECRET_KEY || "").trim();
const sessionSecret = configuredSecret || `insecure-demo-${siteName}`;

app.use(
  session({
    name: ".AadSsoDemo.Session",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: Boolean(process.env.WEBSITE_SITE_NAME),
      maxAge: 30 * 60 * 1000,
    },
  })
);

app.use("/static", express.static(path.join(__dirname, "static")));

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  noCache: process.env.NODE_ENV !== "production",
});

function pathFor(name) {
  const routes = {
    index: "/",
    login: "/login",
    login_msal: "/login/msal",
    login_easyauth: "/login/easyauth",
    profile: "/profile",
    profile_msal: "/profile/msal",
    profile_easyauth: "/profile/easyauth",
    logout: "/logout",
    logout_msal: "/logout/msal",
    logout_easyauth: "/logout/easyauth",
    logout_all: "/logout/all",
  };
  return routes[name] || "/";
}

function staticUrl(filename, cacheToken) {
  const params = new URLSearchParams();
  if (cacheToken) {
    params.set("v", cacheToken);
  }
  const query = params.toString();
  return query ? `/static/${filename}?${query}` : `/static/${filename}`;
}

app.use((req, res, next) => {
  res.locals.path_for = pathFor;
  res.locals.static_url = staticUrl;
  next();
});

app.use((req, res, next) => {
  const activeAuthModes = [];
  if (req.session.msalUser) {
    activeAuthModes.push("MSAL");
  }
  if (getEasyAuthUser(req)) {
    activeAuthModes.push("Easy Auth");
  }

  const authHealth = buildAuthHealth(req);
  res.locals.active_auth_modes = activeAuthModes;
  res.locals.is_signed_in = activeAuthModes.length > 0;
  res.locals.cache_token = req.query.cb || "";
  res.locals.app_service_portal_url = buildAppServicePortalUrl(req);
  res.locals.app_registration_portal_url = buildAppRegistrationPortalUrl(req);
  res.locals.session_timeline = getSessionTimeline(req).slice(0, 8);
  res.locals.auth_health = authHealth;
  res.locals.auth_health_ready = authHealth.every((item) => item.ok);
  res.locals.runtime_info = getRuntimeInfo();

  next();
});

function addGetMethod(obj) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }
  if (typeof obj.get !== "function") {
    Object.defineProperty(obj, "get", {
      enumerable: false,
      value(key, defaultValue = undefined) {
        const value = this[key];
        return value === undefined || value === null ? defaultValue : value;
      },
    });
  }
  return obj;
}

function buildMsalClient() {
  const authority = `https://login.microsoftonline.com/${config.aadTenantId}`;
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.aadClientId,
      clientSecret: config.aadClientSecret,
      authority,
    },
  });
}

function buildRedirectUri(req) {
  if (config.aadRedirectUri.trim()) {
    return config.aadRedirectUri.trim();
  }
  return new URL(config.aadRedirectPath.replace(/^\//, ""), `${req.protocol}://${req.get("host")}/`).toString();
}

function buildPostLogoutRedirectUri(req) {
  if (config.aadPostLogoutRedirectUri.trim()) {
    return config.aadPostLogoutRedirectUri.trim();
  }
  return `${req.protocol}://${req.get("host")}/`;
}

function getSiteNameFromHost(req) {
  const host = (req.get("host") || "local-demo").split(":")[0];
  return host.split(".")[0];
}

function buildAppServicePortalUrl(req) {
  if (config.appServicePortalUrl.trim()) {
    return config.appServicePortalUrl.trim();
  }
  const subscriptionId = config.appServiceSubscriptionId.trim();
  const resourceGroup = config.appServiceResourceGroup.trim();
  const appServiceName = encodeURIComponent(config.appServiceName.trim() || getSiteNameFromHost(req));

  if (subscriptionId && resourceGroup && appServiceName) {
    return `https://portal.azure.com/#resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${appServiceName}/overview`;
  }

  const inferredSite = encodeURIComponent(getSiteNameFromHost(req));
  return `https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.Web%2Fsites/search/${inferredSite}`;
}

function buildAppRegistrationPortalUrl(req) {
  if (config.appRegistrationPortalUrl.trim()) {
    return config.appRegistrationPortalUrl.trim();
  }
  const appId = encodeURIComponent(config.aadClientId.trim());
  if (appId) {
    return `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/${appId}`;
  }

  const searchText = encodeURIComponent(getSiteNameFromHost(req));
  return `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade/searchText/${searchText}`;
}

function buildEasyAuthLoginUrl(req, postLoginRedirectUri) {
  const query = new URLSearchParams({ post_login_redirect_uri: postLoginRedirectUri });
  return `${config.easyAuthLoginPath}?${query.toString()}`;
}

function buildEasyAuthLogoutUrl(req, postLogoutRedirectUri) {
  const query = new URLSearchParams({ post_logout_redirect_uri: postLogoutRedirectUri });
  return `${config.easyAuthLogoutPath}?${query.toString()}`;
}

function getRuntimeInfo() {
  const osType = (process.env.WEBSITE_OS || "").trim() || (process.platform === "win32" ? "Windows" : "Linux");
  const stack = (process.env.WEBSITE_STACK || "").trim() || "Node.js";
  const version = process.version;
  const stackValue = buildStackDisplayValue(stack, version);

  return [
    { label: "OS Type", value: osType },
    { label: "Stack", value: stackValue },
  ];
}

function buildStackDisplayValue(stack, version) {
  const normalizedStack = stack.trim();
  const normalizedVersion = version.trim();
  const stackKey = normalizedStack.toLowerCase().replace(/[^a-z0-9]/g, "");
  const versionKey = normalizedVersion.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (!normalizedStack) {
    return normalizedVersion;
  }

  if (!normalizedVersion || versionKey.includes(stackKey)) {
    return normalizedVersion || normalizedStack;
  }

  return `${normalizedStack} ${normalizedVersion}`;
}

function getEasyAuthUser(req) {
  const principalHeader = req.get("X-MS-CLIENT-PRINCIPAL") || "";
  if (!principalHeader) {
    return null;
  }

  try {
    const payload = Buffer.from(principalHeader, "base64").toString("utf8");
    const principal = JSON.parse(payload);
    const claims = principal.claims || [];
    const claimMap = {};
    for (const claim of claims) {
      if (claim?.typ && claim?.val) {
        claimMap[claim.typ] = claim.val;
      }
    }

    const firstClaim = (...keys) => {
      for (const key of keys) {
        if (claimMap[key]) {
          return claimMap[key];
        }
      }
      return "";
    };

    return addGetMethod({
      name:
        firstClaim("name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ||
        principal.userDetails ||
        "",
      preferred_username:
        firstClaim(
          "preferred_username",
          "upn",
          "email",
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
        ) || principal.userDetails || "",
      tid: firstClaim("tid", "tenantid", "http://schemas.microsoft.com/identity/claims/tenantid"),
      oid:
        firstClaim(
          "oid",
          "objectidentifier",
          "http://schemas.microsoft.com/identity/claims/objectidentifier",
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"
        ) || principal.userId || "",
      identity_provider: principal.identityProvider || "",
      authentication_type: principal.auth_typ || "",
      user_id: principal.userId || "",
      user_details: principal.userDetails || "",
      claims: claimMap,
    });
  } catch {
    return null;
  }
}

function buildClaimItems(claims) {
  if (!claims || typeof claims !== "object") {
    return [];
  }
  return Object.keys(claims)
    .sort()
    .map((key) => [key, claims[key]])
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) && String(value).trim() !== "")
    .map(([key, value]) => [key, String(value)]);
}

function addTimelineEvent(req, event, mode = "", detail = "") {
  const timeline = req.session.sessionTimeline || [];
  timeline.push({
    event,
    mode,
    detail,
    at: new Date().toISOString().replace("T", " ").slice(0, 19),
  });
  req.session.sessionTimeline = timeline.slice(-12);
}

function getSessionTimeline(req) {
  return [...(req.session.sessionTimeline || [])].reverse();
}

function maskValue(value) {
  if (!value) {
    return "missing";
  }
  if (value.length <= 8) {
    return value;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function buildAuthHealth(req) {
  const configuredRedirectUri = config.aadRedirectUri.trim() || "auto from host + path";
  const secretIsExplicit = Boolean(configuredSecret);
  return [
    {
      name: "AAD_CLIENT_ID",
      ok: Boolean(config.aadClientId.trim()),
      value: maskValue(config.aadClientId.trim()),
    },
    {
      name: "AAD_CLIENT_SECRET",
      ok: Boolean(config.aadClientSecret.trim()),
      value: config.aadClientSecret.trim() ? "configured" : "missing",
    },
    {
      name: "AAD_TENANT_ID",
      ok: Boolean(config.aadTenantId.trim()),
      value: config.aadTenantId.trim() || "missing",
    },
    {
      name: "AAD_REDIRECT_PATH",
      ok: config.aadRedirectPath.startsWith("/"),
      value: config.aadRedirectPath,
    },
    {
      name: "AAD_REDIRECT_URI",
      ok: true,
      value: configuredRedirectUri,
    },
    {
      name: "FLASK_SECRET_KEY",
      ok: secretIsExplicit,
      value: secretIsExplicit ? "explicit" : "demo fallback",
    },
  ];
}

function normalizeClaimValues(value) {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (["number", "boolean"].includes(typeof value)) {
    return [String(value)];
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return [];
    }
    if (text.startsWith("[") && text.endsWith("]")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v).trim()).filter(Boolean);
        }
      } catch {
        // keep raw string fallback.
      }
    }
    if (text.includes(",")) {
      return text.split(",").map((part) => part.trim()).filter(Boolean);
    }
    return [text];
  }
  return [];
}

function dedupeValues(values) {
  return [...new Set(values)];
}

function buildIdentityBadges(user) {
  const tenant = [];
  const roles = [];
  const tid = (user?.tid || "").trim();
  if (tid) {
    tenant.push(tid);
  }

  const claimsSource = user?.claims;
  let roleValues = [];
  let groupValues = [];

  if (claimsSource && typeof claimsSource === "object") {
    roleValues = normalizeClaimValues(
      claimsSource.roles ||
        claimsSource.role ||
        claimsSource["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"]
    );
    groupValues = normalizeClaimValues(claimsSource.groups);
  } else {
    roleValues = normalizeClaimValues(user?.roles);
    groupValues = normalizeClaimValues(user?.groups);
  }

  if (!roleValues.length) {
    roleValues = normalizeClaimValues(user?.roles);
  }

  roles.push(...roleValues.slice(0, 8));
  if (groupValues.length) {
    roles.push(...groupValues.slice(0, 4).map((value) => `group:${value}`));
  }

  return {
    tenant: dedupeValues(tenant),
    roles: dedupeValues(roles),
  };
}

app.get("/", (req, res) => {
  const msalUser = req.session.msalUser ? addGetMethod(req.session.msalUser) : null;
  res.render("index.njk", {
    msal_user: msalUser,
    easy_auth_user: getEasyAuthUser(req),
  });
});

app.get("/login/msal", async (req, res) => {
  addTimelineEvent(req, "MSAL sign-in started", "MSAL");

  const state = crypto.randomBytes(16).toString("hex");
  req.session.authState = state;

  try {
    const msalClient = buildMsalClient();
    const redirectUri = buildRedirectUri(req);

    const authUrl = await msalClient.getAuthCodeUrl({
      scopes: config.aadScopes,
      redirectUri,
      state,
      prompt: "select_account",
    });

    res.redirect(authUrl);
  } catch (error) {
    req.session.authState = null;
    res.render("auth_error.njk", {
      error: "login_start_failed",
      error_description: error instanceof Error ? error.message : "Unable to initiate MSAL auth flow",
    });
  }
});

app.get("/login", (req, res) => res.redirect(pathFor("login_msal")));

app.get("/login/easyauth", (req, res) => {
  addTimelineEvent(req, "Easy Auth sign-in started", "Easy Auth");
  const postLoginRedirectUri = `${req.protocol}://${req.get("host")}${pathFor("profile_easyauth")}`;
  res.redirect(buildEasyAuthLoginUrl(req, postLoginRedirectUri));
});

app.get(config.aadRedirectPath, async (req, res) => {
  if (req.query.error) {
    req.session.authState = null;
    return res.render("auth_error.njk", {
      error: req.query.error,
      error_description: req.query.error_description,
    });
  }

  if (!req.query.code || !req.session.authState || req.session.authState !== req.query.state) {
    req.session.authState = null;
    return res.redirect(pathFor("index"));
  }

  try {
    const msalClient = buildMsalClient();
    const tokenResponse = await msalClient.acquireTokenByCode({
      code: req.query.code,
      scopes: config.aadScopes,
      redirectUri: buildRedirectUri(req),
    });

    req.session.msalUser = addGetMethod(tokenResponse.idTokenClaims || {});
    req.session.msalAccessToken = tokenResponse.accessToken;
    req.session.authState = null;

    addTimelineEvent(req, "MSAL sign-in completed", "MSAL");
    return res.redirect(pathFor("profile_msal"));
  } catch (error) {
    req.session.authState = null;
    return res.render("auth_error.njk", {
      error: "token_acquisition_failed",
      error_description: error instanceof Error ? error.message : "Unknown MSAL error",
    });
  }
});

app.get("/profile/msal", (req, res) => {
  const user = req.session.msalUser ? addGetMethod(req.session.msalUser) : null;
  if (!user) {
    return res.redirect(pathFor("login_msal"));
  }

  addTimelineEvent(req, "Viewed profile", "MSAL");
  const badges = buildIdentityBadges(user);
  return res.render("profile.njk", {
    user,
    auth_mode: "MSAL",
    claim_items: buildClaimItems(user),
    tenant_badges: badges.tenant,
    role_badges: badges.roles,
  });
});

app.get("/profile", (req, res) => res.redirect(pathFor("profile_msal")));

app.get("/profile/easyauth", (req, res) => {
  const user = getEasyAuthUser(req);
  if (!user) {
    return res.redirect(pathFor("login_easyauth"));
  }

  addTimelineEvent(req, "Viewed profile", "Easy Auth");
  const badges = buildIdentityBadges(user);
  return res.render("profile.njk", {
    user,
    auth_mode: "Easy Auth",
    claim_items: buildClaimItems(user.claims || {}),
    tenant_badges: badges.tenant,
    role_badges: badges.roles,
  });
});

app.get("/logout/msal", (req, res) => {
  addTimelineEvent(req, "Signed out", "MSAL");
  req.session.msalUser = null;
  req.session.msalAccessToken = null;
  req.session.authState = null;
  res.redirect(pathFor("index"));
});

app.get("/logout", (req, res) => res.redirect(pathFor("logout_msal")));

app.get("/logout/easyauth", (req, res) => {
  addTimelineEvent(req, "Signed out", "Easy Auth");
  res.redirect(buildEasyAuthLogoutUrl(req, `${req.protocol}://${req.get("host")}${pathFor("index")}`));
});

app.get("/logout/all", (req, res) => {
  addTimelineEvent(req, "Signed out", "All");
  req.session.msalUser = null;
  req.session.msalAccessToken = null;
  req.session.authState = null;

  if (getEasyAuthUser(req)) {
    return res.redirect(buildEasyAuthLogoutUrl(req, `${req.protocol}://${req.get("host")}${pathFor("index")}`));
  }

  return res.redirect(pathFor("index"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Node demo app listening on port ${port}`);
});
