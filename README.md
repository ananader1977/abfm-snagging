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


## Workflow email notifications

The app sends notification email after server-side saves when a case is assigned for inspection, an RFQ is issued, client approval authorizes work, or a supplier submits a work completion report for reinspection. Add these Render environment variables to enable delivery:

- `SMTP_USER=ananader1@gmail.com` (default sender account)
- `SMTP_PASS` = a Google App Password for that account (store only as a Render secret)
- `RAHATI_EMAIL` = Rahati Bayti notification email address
- `ENGINEER_EMAILS` = comma-separated ABFM inspection team email addresses
- `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=465` are the defaults; `SMTP_FROM` and `APP_BASE_URL` are optional overrides.

ABFM administrators can edit Rahati’s and the engineers’ recipient addresses in the application’s Workflow email recipients settings. Those addresses are saved in PostgreSQL. A record is saved even if email delivery is unavailable; the app shows that a notification needs attention.
