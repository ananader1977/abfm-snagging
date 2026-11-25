# Al Bonian FM Snagging Application

This branded workflow prototype uses synthetic cases and stores records in the current browser. Use the sign-in server to access it.

1. Set the environment variable `SNAGGING_PASSWORD` to a unique password of at least 16 characters. Set `SNAGGING_USERNAME` to override the default username, `abfm-admin`.
2. Run `npm start` using Node.js 22 or newer.
3. Open http://127.0.0.1:3000 and sign in with the configured credentials.

For remote access, deploy the Node server behind HTTPS. Set `HOST=0.0.0.0` on the hosting service and enter the password in its secret or environment settings. Use the browser sign-in prompt. GitHub Pages cannot run the sign-in server.

Walk through a request, confirm snags, record bids from Rahati Bayti and Guardian, approve the chosen scope through CS and the client, and submit supplier WCR evidence for ABFM Engineer verification. Print the inspection, quotation and completion report previews.

The sign-in protects access to the prototype. Shared records, organization-specific permissions, official Dynamics form matching, email and live Dynamics synchronization are pending. Use synthetic data only. Keep original documents, rates and credentials out of source control.
