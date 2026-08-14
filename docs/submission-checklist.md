# Chrome Web Store Submission Checklist

Manual steps to perform in the Chrome Web Store Developer Dashboard (https://chrome.google.com/webstore/devconsole). None of this can be done on your behalf — it requires your own Google account and payment method.

1. If you haven't already, register as a Chrome Web Store developer (one-time $5 USD fee). Also verify a contact email in your developer account settings — Google requires this before an item can be published.
2. Host `privacy-policy.html` somewhere with a public URL (GitHub Pages, a Gist's raw view, Google Sites, etc.) and note the URL.
3. Build the submission package: run `./package.sh` from the repo root to produce `recent-tabs.zip`.
4. In the dashboard, click "New Item" and upload `recent-tabs.zip`.
5. Fill in the "Store Listing" tab using the copy from `docs/store-listing.md`:
   - Summary
   - Description
   - Category (suggest: Productivity)
   - Language
6. Capture at least one screenshot for the listing (Chrome Web Store requires 1280x800 or 640x400 PNG/JPEG). A screenshot of the popup showing the recent-tabs list, or the cycling overlay, works well. Upload it under the "Store Listing" tab's screenshots section.
7. Under "Privacy practices":
   - Paste the privacy policy URL from step 2.
   - Fill in the single-purpose description and permission justifications from `docs/store-listing.md`.
   - Declare data usage honestly: no data collected, no data sold, no data used for purposes unrelated to the extension's core functionality.
8. Under "Distribution" / "Visibility", set the listing to **Unlisted**.
9. Upload the 128×128 icon (`icons/icon128.png`) as the store listing icon if the dashboard requests one separately from the manifest icon.
10. Review the summary page, then submit for review.
11. Chrome Web Store review can take anywhere from a few hours to several days. You'll receive an email when it's approved (or if changes are requested).
