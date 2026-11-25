# Al Bonian FM Snagging Application

This branded workflow prototype uses synthetic cases and stores records in the current browser. Use the sign-in server to access it.

1. Set the environment variable `SNAGGING_PASSWORD` to a unique password of at least 16 characters. Set `SNAGGING_USERNAME` to override the default username, `abfm-admin`.
2. Run `npm start` using Node.js 22 or newer.
3. Open http://127.0.0.1:3000 and sign in with the configured credentials.

## Deploy from GitHub

In [Render Blueprints](https://dashboard.render.com/blueprints), select **New Blueprint** and connect this repository on `main`. Render reads the root `render.yaml` and provisions the Node web service using the free plan. Enter your chosen `SNAGGING_USERNAME` and a unique `SNAGGING_PASSWORD` of at least 16 characters in the setup form. Use the service's HTTPS URL to sign in after deployment. Update either value later in the service's **Environment** settings and redeploy.

The free service may take time to wake after inactivity. GitHub Pages serves static assets and does not run the sign-in server.

Walk through a request, confirm snags, record bids from Rahati Bayti and Guardian, approve the chosen scope through CS and the client, and submit supplier WCR evidence for ABFM Engineer verification. Print the inspection, quotation and completion report previews.

The sign-in protects access to the prototype. Shared records, organization-specific permissions, official Dynamics form matching, email and live Dynamics synchronization are pending. Use synthetic data only. Keep original documents, rates and credentials out of source control.
