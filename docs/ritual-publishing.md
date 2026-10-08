# Live generation and website publishing

Ritual Coding already streams generated project files from OpenAI. Its Build menu now includes **Check live AI connection** and **Publish website**. The connection check makes a small, real completion request and requires text back; it uses API tokens.

## Configure the Grandpa AI host

Keep these values in the host's environment, never in generated websites:

- `OPENAI_API_KEY`: an active OpenAI project key with model access and billing.
- `ENABLE_BUILDING=true`: enable Ritual Coding.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: from your GitHub OAuth app.
- `GITHUB_SEAL_KEY`: the existing stable secret used to seal tokens and publication receipts.

Register the OAuth callback as `https://YOUR-APP-HOST/api/github/callback`. For the current app URL, use `https://libgpt.vercel.app/api/github/callback`. Follow the existing GitHub setup in README for seal-key format and production cookie settings. Redeploy Grandpa AI after changing environment variables.

Normal repository connections keep their configured scope. The publishing button explicitly requests GitHub's `repo` OAuth scope, which GitHub requires for the Pages API. This permission can include private repositories; the app explains it before redirecting to GitHub. Tokens remain in sealed HttpOnly cookies and are sent to GitHub from the server.

## Publish a generated website

1. Open Build, check the live AI connection, then describe the website you want.
2. Review the generated preview, fix reported issues, and test buttons and forms.
3. Choose **Publish website** in the Build menu and authorize GitHub publishing.
4. Return to Build, choose **Publish website**, review the repository name and public-file notice, and click **Publish publicly**.
5. The app creates a new public repository in your account, uploads the complete project in one commit, starts GitHub Pages, and displays a website link.
6. Use the same publishing action for updates. Status changes to **Live** only when GitHub reports the requested commit as built.

The app polls for about 90 seconds. If GitHub needs longer, use **Check deployment status**. If uploading or configuring Pages fails after repository creation, retry from the same saved project: its signed receipt reuses that repository. Keep the seal key stable and project browser storage intact to retain this association. Existing, unrelated repositories cannot be selected by this publishing flow.

## Supported projects

This publishes static HTML, CSS, JavaScript, JSON, text, SVG, and supported image files. A root `index.html` is required. Use relative links and asset URLs so pages work under `/<repository>/`. Hidden files and unsupported file types are refused. Limits are 60 input files and 1.5 MB of decoded contents; a `.nojekyll` file is added automatically.

All published source files and the resulting website are public. Review them before confirming. The generated site's JavaScript runs in visitors' browsers: never embed provider keys, secrets, or private data.

Server-side APIs, databases, authentication services, and payment processing need separate backend hosting. Publishing does not automatically give a generated website access to Grandpa AI's OpenAI key.

GitHub Pages remains an external build service. The app verifies build status, not every browser interaction. Source checks and deployment tests run without real API credentials; validate a real generation and publication on the configured host.
