# Tools

Headless-browser scripts used to check the theme against a running admin.
Install with `npm install` in this folder. Each script needs `CHROME` set to a
Chromium binary, for example one of Playwright's builds under
`~/.cache/ms-playwright`.

| Script | What it does |
| --- | --- |
| `auth.mjs <admin-url> <user> <password> <otp> state.json` | Signs in, completes the authenticator step and saves the session for the other scripts. |
| `shots.mjs state.json <out-dir> "name\|url\|light or dark\|full or blank\|optional click selector" ...` | Screenshots pages with the saved session. |
| `login.mjs <url> <out.png>` | Screenshots a page with no session, such as the sign-in screen. |
| `crop.mjs state.json <url> <selector> <out.png> [dark]` | Screenshots one element at 2x. |
| `axe.mjs state.json report.json "name\|url\|mode" ...` | Runs axe-core (WCAG 2.1 AA plus best practice) on each page and writes the violations. |
| `census.mjs state.json report.json "name\|url\|mode" ...` | Lists rounded corners, shadows, gradients, Tailwind greys, non-Archivo text, heavy weights, orange text and the distinct button, input and label variants on each page. |
| `align.mjs state.json <url> ...` | Measures the vertical offset between each form label and its control. |

Keep the sign-in page out of any authenticated run: logging out invalidates the
saved session for the pages after it.
