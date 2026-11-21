# Grok Bot (desk-app)

Static phone app for the FOMO desk, served from GitHub Pages.

The published tree holds no secrets and no desk data. On first open, paste a
fine-grained GitHub token that can read and write Contents on the private
`desk-data` repo. The token stays in this phone's localStorage and is never
sent back to the box or committed here.

Data is read from `desk-data` on `main`. Commands are written to
`commands/{ts}.json` on the `inbox` branch.
