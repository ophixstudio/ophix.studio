# Ophix Studio

Ophix Studio is a static portfolio and work site for Brad Schmidt's AI-powered creative strategy, UGC ad creative, copywriting, and performance marketing practice.

The site is built as a lightweight HTML, CSS, and JavaScript project. It does not require a build step.

## Live Site

Planned production URL:

```text
https://ophix.studio
```

## Pages

- `index.html` - Main Ophix Studio homepage
- `work.html` - Work and creative portfolio page
- `brand/` - Logos, SVG assets, favicon files, and local fonts

## Preview Locally

Open the homepage directly in a browser:

```text
index.html
```

Or run a local static server from this folder:

```sh
python3 -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## Project Structure

```text
ophix-studio/
  index.html
  work.html
  brand/
    favicon/
    fonts/
    svg/
  ledger.html
  ledger-app.html
  ledger-pay.html
  ledger-server.js
  ledger-data.json
```

## Brand Positioning

Ophix Studio builds AI-powered ad creative for brands that need sharper hooks, faster testing, and cleaner conversion paths.

Core services:

- AI ad creative
- UGC ad strategy
- Copywriting
- Master prompting
- Creative systems
- Paid social support
- Performance marketing consulting

## Social Preview Metadata

The homepage includes Open Graph and Twitter/X card metadata for social sharing previews.

Expected production assets:

```text
https://ophix.studio/og-image.jpg
https://ophix.studio/favicon.png
```

Recommended preview image size:

```text
1200 x 630
```

Before launch, make sure both files exist at the production domain root.

## Deployment

This is a static site, so deployment can be handled by any static host, including GitHub Pages, Netlify, Vercel, Cloudflare Pages, or a standard web server.

For deployment, upload the website files and preserve the folder structure so local font and brand asset paths keep working.

Minimum production files:

- `index.html`
- `work.html`
- `brand/`
- `og-image.jpg`
- `favicon.png`

## Launch Checklist

- Confirm `https://ophix.studio` points to the deployed site
- Add `og-image.jpg` at the domain root
- Add `favicon.png` at the domain root
- Test link previews in iMessage, Slack, Discord, LinkedIn, Facebook, and X/Twitter
- Review `work.html` and replace any placeholder case study details
- Test desktop and mobile layouts
- Check all navigation links
- Confirm contact email links open correctly

## Ophix Ledger Prototype

This folder also contains an Ophix Ledger ACH prototype. It is separate from the main marketing website.

Run the local Node server:

```sh
node ledger-server.js
```

Then visit:

```text
http://127.0.0.1:8787/ledger
```

Demo client payment links use:

```text
http://127.0.0.1:8787/pay?token=demo-ach-opx-1042
```

Security notes:

- The ledger prototype is local-only.
- Demo ledger data is stored in `ledger-data.json`.
- It does not collect or store bank account or routing numbers.
- Real ACH should be handled by a dedicated provider such as Dwolla, Moov, Stripe Financial Connections, or another compliant payment provider.
- The site should store provider IDs, payment statuses, and webhook events only.
