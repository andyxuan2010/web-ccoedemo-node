# Architecture - Web CCoE Demo (Node)

## 1. Purpose

This application demonstrates two Entra ID authentication integration models on Azure App Service:

1. App-managed sign-in using MSAL (authorization code flow).
2. Platform-managed sign-in using App Service Easy Auth.

Both are exposed in one UI to compare behavior, claims, and operational tradeoffs.

## 2. High-Level Architecture

### Core components

- Browser client (UI rendered via Nunjucks)
- Node.js Express web app (`app.js`)
- MSAL Node confidential client (`@azure/msal-node`)
- Azure App Service Authentication/Authorization (Easy Auth)
- Microsoft Entra ID tenant

### Trust boundaries

- Browser <-> App Service: HTTPS boundary
- App Service <-> Entra ID: OAuth/OpenID Connect boundary
- Easy Auth identity header (`X-MS-CLIENT-PRINCIPAL`) trusted only when emitted by App Service

## 3. Application Layers

### HTTP and rendering layer

- Express handles routing.
- Nunjucks renders templates in `views/`.
- Static files served from `/static`.

### Session and state layer

- `express-session` cookie-backed session id.
- Current session store: in-memory (default MemoryStore).
- Session keys include:
  - `msalUser`
  - `msalAccessToken`
  - `authState`
  - `sessionTimeline`

### Auth abstraction layer

`app.js` helper functions centralize auth behavior:

- `buildMsalClient()`
- `buildRedirectUri()`
- `buildEasyAuthLoginUrl()` / `buildEasyAuthLogoutUrl()`
- `getEasyAuthUser()`
- `buildIdentityBadges()`
- `buildAuthHealth()`

## 4. Authentication Flows

## 4.1 MSAL flow (app-managed)

1. User hits `/login/msal`.
2. App generates random `state`, stores in session.
3. App builds MSAL auth URL and redirects to Entra ID.
4. Entra ID returns to `AAD_REDIRECT_PATH` (default `/auth/callback`) with `code` + `state`.
5. App validates state, exchanges code for tokens.
6. App stores `idTokenClaims` in session (`msalUser`), redirects to `/profile/msal`.

Failure paths:

- Login initialization failure renders `auth_error.njk`.
- Callback mismatch/missing code redirects home and clears stale state.
- Token acquisition failure renders `auth_error.njk`.

## 4.2 Easy Auth flow (platform-managed)

1. User hits `/login/easyauth`.
2. App redirects to `/.auth/login/aad` with return URL.
3. App Service handles OIDC with Entra ID.
4. App Service injects `X-MS-CLIENT-PRINCIPAL` header on authenticated request.
5. App decodes Base64 principal, normalizes claims, renders `/profile/easyauth`.

### Example MSAL callback URL

```text
https://web-platform-eus-dev-node.azurewebsites.net/auth/callback?code=0.A...&state=ab12cd34ef56...
```

### Example Easy Auth principal payload (decoded)

```json
{
  "auth_typ": "aad",
  "name_typ": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  "role_typ": "roles",
  "claims": [
    {
      "typ": "name",
      "val": "Alex Example"
    },
    {
      "typ": "preferred_username",
      "val": "alex@example.com"
    },
    {
      "typ": "tid",
      "val": "11111111-1111-1111-1111-111111111111"
    },
    {
      "typ": "oid",
      "val": "22222222-2222-2222-2222-222222222222"
    }
  ]
}
```

## 5. Route Architecture

- `GET /` home and mode selection
- `GET /login/msal` start MSAL flow
- `GET /login/easyauth` start Easy Auth flow
- `GET /auth/callback` MSAL callback (configurable via env)
- `GET /profile/msal` MSAL profile page
- `GET /profile/easyauth` Easy Auth profile page
- `GET /logout/msal` clear MSAL session
- `GET /logout/easyauth` Easy Auth sign-out redirect
- `GET /logout/all` clear local session + Easy Auth logout if active

## 6. UI/Template Architecture

- `views/base.njk`: shared layout, nav, side panel, live metrics, auth health, timeline
- `views/index.njk`: mode cards and signed-in state
- `views/profile.njk`: user profile, badge rendering, claim filtering/copy
- `views/auth_error.njk`: auth error surface

Shared template helpers from middleware:

- `path_for(routeName)`
- `static_url(file, cacheToken)`

## 7. Configuration Model

### Identity settings

- `AAD_CLIENT_ID`
- `AAD_CLIENT_SECRET`
- `AAD_TENANT_ID`
- `AAD_SCOPES`
- `AAD_REDIRECT_PATH`
- `AAD_REDIRECT_URI`
- `AAD_POST_LOGOUT_REDIRECT_URI`

### Easy Auth integration settings

- `EASY_AUTH_LOGIN_PATH`
- `EASY_AUTH_LOGOUT_PATH`

### Operational settings

- `SESSION_SECRET` (recommended)
- `APP_SERVICE_PORTAL_URL`
- `APP_REGISTRATION_PORTAL_URL`
- `APP_SERVICE_NAME`
- `APP_SERVICE_SUBSCRIPTION_ID`
- `APP_SERVICE_RESOURCE_GROUP`

If the portal URL settings are blank, the app builds:

- a direct App Service portal URL from the App Service ARM resource ID components
- a direct App Registration portal URL from `AAD_CLIENT_ID`

The App Service link prefers built-in App Service metadata first:

- `WEBSITE_SITE_NAME`
- `WEBSITE_RESOURCE_GROUP`
- `WEBSITE_OWNER_NAME` (subscription segment)

Pipeline-provided `APP_SERVICE_*` settings are a fallback when those platform values are unavailable.

## 8. Deployment Architecture

Primary pipeline file: `azure-pipelines.yml`

Build stage:

1. Checkout source
2. Install Node 24
3. `npm ci`
4. Run `node --check app.js`
5. Stage the runtime payload (`app.js`, package metadata, `web.config`, `views/`, `static/`)
6. Archive the staged payload into `app.zip`
7. Publish artifact

Post-build pipeline stages:

1. `CreateGitTag` runs after `Build` on successful non-PR executions.
2. `DeploySandbox` uses the shared deploy template with service connection `sc-platform-sbx` and primary target `web-platform-cc-sbx-node`.
3. `DeployDev` uses the shared deploy template with service connection `sc-platform-dev` and primary target `web-platform-eus-dev-node`.

Shared deploy-stage behavior:

1. Check the configured primary App Service target and the optional secondary target.
2. Skip optional targets when the configured name is blank or the App Service does not exist.
3. Run SCM/Kudu connectivity preflight checks before attempting deployment.
4. Detect each target App Service OS with Azure CLI by reading the `reserved` property.
5. If detection identifies Windows, set `WEBSITE_NODE_DEFAULT_VERSION=~24`, enable App Service build automation, and deploy the ZIP package with `az webapp deploy`.
6. If detection identifies Linux, set `linuxFxVersion=NODE|24-lts`, configure `npm start`, enable App Service build automation, and deploy the ZIP package with `az webapp deploy`.
7. If the SCM endpoint is not reachable, fail early with diagnostics instead of waiting for a generic deployment error.

Platform-specific runtime configuration:

- Windows App Service: runtime is controlled through the app setting `WEBSITE_NODE_DEFAULT_VERSION`.
- Linux App Service: runtime is controlled through the site config value `linuxFxVersion`.
- The application entrypoint remains `node app.js` through `npm start` on Linux and `web.config`/iisnode on Windows.
- The application has been validated on a Windows App Service 32-bit worker process.
- App Service build automation is enabled through `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and `ENABLE_ORYX_BUILD=true` in the primary pipeline.

Deployment model notes:

- The build artifact is produced once and reused for all deployment targets.
- Target OS selection is resolved at deploy time rather than being hard-coded in the pipeline.
- SCM/Kudu DNS, TCP, and HTTPS checks run before each deployment to catch private-endpoint routing issues earlier.
- The deployment baseline is Node.js 24 LTS for both Windows and Linux App Service targets.
- The deploy template supports one primary and one optional secondary App Service target per stage; the checked-in pipeline currently leaves the secondary target blank.
- Windows targets receive an explicit `WEBSITE_NODE_DEFAULT_VERSION` setting before ZIP deployment.
- Linux targets retain the explicit Node runtime and startup command configuration before ZIP deployment.
- A separate `run_from_package.yml` pipeline exists for immutable package deployment using `WEBSITE_RUN_FROM_PACKAGE=1`.
- Windows 32-bit support is a compatibility characteristic of the app and hosting model, not a separate code path in the application.

### Example request path sequence

```text
GET /login/msal
 -> 302 to https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize...
 -> 302 back to /auth/callback?code=...&state=...
 -> 302 to /profile/msal
 -> 200 profile page
```

## 9. Security Considerations

- Use a strong `SESSION_SECRET` in App Service settings.
- Never commit credential values.
- Restrict who can reach Kudu/SCM deployment endpoints.
- Easy Auth header parsing must only be trusted behind App Service auth.
- In-memory session store is not durable for multi-instance production.

## 10. Scalability and Reliability Notes

- Current memory session store can lose sessions on restart/scale events.
- Recommended production improvement: Redis session store.
- Add centralized logging/metrics for auth failures and callback errors.
- Consider health probes and synthetic sign-in checks for release validation.
