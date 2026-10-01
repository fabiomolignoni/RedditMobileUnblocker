# Privacy policy — Reddit Mobile Unblocker

Applies to version 1.2.0. Updated 1 October 2026.

Reddit Mobile Unblocker does not collect or transmit personal data. It has no
analytics, telemetry, advertising, remote code, or external services. It makes
no automatic network requests of its own. The popup contains links to GitHub
and Ko-fi; opening them is an explicit user action governed by those sites.

The extension operates locally on the top-level HTTPS pages of reddit.com,
www.reddit.com, m.reddit.com and sh.reddit.com. It inspects page elements to
identify known app promotions, hides them, and corrects associated interaction
and scrolling restrictions. It does not read or clear cookies, passwords,
account credentials, browsing history, posts, or private messages for collection.
The popup reads the current tab's local protection status. The extension stores
one cumulative number of recognized app prompts blocked in Firefox's local
extension storage. It persists across page loads and browser restarts until the
extension is removed or its data is cleared. The count contains no URLs, page
content, account information, or browsing history, and is not transmitted.

It writes the current date to the site's localStorage key
`xpromo-consolidation` to discourage app promotions. This value belongs to the
Reddit origin, is accessible to Reddit's own scripts, and may persist after the
extension is disabled or uninstalled. The extension does not restore its previous
value. Other site storage and session cookies are left untouched. Normal Reddit
page requests and Reddit's own data practices are outside the extension's control.

To stop the extension's page modifications, disable or remove it in Firefox's
extension manager and reload open Reddit tabs. No data is sent to the extension's
developer. Any information you choose to send through a support channel is
separate from the extension's operation.
