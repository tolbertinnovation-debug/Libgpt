# Approved website publishing and recovery

## Host configuration

Configure OPENAI_API_KEY, ENABLE_BUILDING=true, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and a stable GITHUB_SEAL_KEY on the Grandpa AI host. Register the OAuth callback for the actual host at /api/github/callback. Follow README for secret formats and cookie settings. Never place these credentials in generated websites.

Publishing requests GitHub repo scope. Automatic release monitoring also requests workflow scope. Tokens stay sealed in HttpOnly cookies and server-side GitHub requests. GitHub Actions must be available and enabled for unattended scheduled monitoring.

## Configure a project once

Build a website and resolve the team's reported issues. Choose Publish website to configure the public repository target, authorize GitHub and optionally enable automatic approved updates. The configuration explains that all published files become public. Existing unrelated repositories cannot be selected through this flow.

Once configured, approved updates automatically publish to that project target without repeated human engineering sign-off. The server independently verifies the signed approval against every submitted file before any GitHub write. Expired approval or changed files require fresh gates. Direct file pushes are disabled so they cannot bypass the approver.

All files are uploaded in one atomic commit. The app retains a sealed receipt identifying the repository, exact deployment commit and last verified healthy approved version. Keep browser project storage and the seal key stable. Pause automatic releases from the publication controls if desired.

## Deployment and rollback

Live status requires GitHub Pages to build the exact requested commit and the fixed website URL to return HTTP 200. If the initial polling window ends, Check deployment status continues the same deployment check. A failed initial release has no prior healthy version to restore.

For approved updates, a definite Pages build failure or two failed bounded health probes can restore the signed prior healthy approved tree using a new commit. Cancellation and a single transient failed probe do not trigger rollback. The app refuses to overwrite an unrelated newer branch change and never force-pushes history.

Automatic mode adds a trusted server-authored GitHub workflow, scheduled about every fifteen minutes and available through workflow_dispatch. It checks the expected artifact manifest and exact current deployment. It runs no generated scripts, performs no checkout and installs no generated dependencies. A failed release can restore only its fixed previous healthy approved commit. The restoration message and artifact binding prevent cascading rollbacks. GitHub scheduling and build availability remain external dependencies.

## Supported deployment types

GitHub Pages supports public static HTML, CSS, JavaScript, JSON, text, SVG and supported images. A root index.html is required. Use relative asset links under the repository path. Limits are seventy-two input files and 1.5 MB decoded contents. A .nojekyll file and, when enabled, the trusted monitoring workflow are added by the server; generated hidden files remain rejected.

Backend, authentication, payment and database code can be generated and saved, but cannot pass the static production gate without a verified runtime and test environment. The app does not execute generated backend code or share its provider credentials with generated websites.

Automated source checks, mock provider tests and browser startup checks have practical limits. They do not certify every interaction or external service. Release results show what passed and what remains blocked.
