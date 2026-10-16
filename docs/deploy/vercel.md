# Deploying to Vercel

One GitHub repository holds everything: the two apps (`clients/`, `admin/`) and the shared packages
(`packages/questionbank`, `packages/engine`, `packages/report`). It uses **npm workspaces**: one
`package-lock.json` at the repo root, and the apps import the packages as `@mfb/...`.

On Vercel this becomes **two projects connected to the same repository**, one per app. Each project
installs from the repo root (so the packages are linked) and builds its own app folder. You do not
publish or install the packages separately: `npm ci` at the root links them automatically.

```
GitHub repo ──┬── Vercel project "mfb-clients"  Root Directory: clients  → app.myfitbrain.app
              └── Vercel project "mfb-admin"    Root Directory: admin    → admin.myfitbrain.app
```

---

## 1. Before the first deploy

1. **Database.** The current Supabase project already has every migration and the question bank. For a
   **new** Supabase project follow `docs/deploy/new-supabase-project.md`: the question-bank load files
   must run between certain migrations, so do not simply run every migration first.

2. **GitHub.** Push the repository (private). `.gitignore` keeps out `node_modules/`, `.next/`, every
   `.env*` file except the `.env.example` templates, build output, logs and local tooling. Check before
   the first push:

   ```bash
   git status --ignored        # .env.local files must be listed under "Ignored"
   git ls-files | grep -E "\.env"   # only clients/.env.example and admin/.env.example
   ```

3. **Local check** (optional, same steps Vercel runs):

   ```bash
   npm ci && npm run lint && npm test && npm run build
   ```

---

## 2. Create the two Vercel projects

In Vercel: **Add New… → Project → Import** the GitHub repository. Do this **twice**, once per app, and
set these before the first deploy (Project → Settings → General / Build and Deployment):

| Setting | Client portal | Staff portal |
|---|---|---|
| Project name | `mfb-clients` | `mfb-admin` |
| Framework Preset | Next.js | Next.js |
| **Root Directory** | `clients` | `admin` |
| **Include files outside the Root Directory in the Build Step** | **ON** | **ON** |
| **Install Command** (override) | `cd .. && npm ci` | `cd .. && npm ci` |
| Build Command | default (`next build`) | default (`next build`) |
| Output Directory | default | default |
| Node.js Version | 22.x | 22.x |

Why each one:

- **Root Directory** tells Vercel which app this project is.
- **Include files outside the Root Directory** lets the build read `packages/`, `brand/` (report PDF
  fonts and logos) and the root `package-lock.json`.
- **`cd .. && npm ci`** installs from the repo root, which installs every workspace and links the
  `@mfb/*` packages into `node_modules`. Running `npm install` inside an app would not find them.
- Node 22.x matches `"engines"` in the `package.json` files (Next.js 16 needs 20.9 or later).

**Function region** (Settings → Functions): choose the region closest to the Supabase project (Supabase
→ Project Settings → General shows it). For a Supabase project in Mumbai (`ap-south-1`) choose
**Mumbai, India (bom1)**. Every page and answer talks to the database, so this matters more than
anything else for speed.

**Only build what changed** (optional, Settings → Git → Ignored Build Step, "Custom"):

```bash
git diff --quiet HEAD^ HEAD -- . ../packages ../package-lock.json ../brand
```

(Run from the Root Directory: a change only in `admin/` will not rebuild `mfb-clients`, and the other
way round.)

---

## 3. Environment variables

Settings → Environment Variables. Add each for **Production** (and **Preview** if you use preview
deploys). Never prefix a secret with `NEXT_PUBLIC_`: those are sent to the browser.

### `mfb-clients`

| Variable | Value | Secret |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → `anon` `public` key | no |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → `service_role` key | **yes** |
| `NEXT_PUBLIC_CLIENTS_URL` | `https://app.myfitbrain.app` | no |
| `NEXT_PUBLIC_ADMIN_URL` | `https://admin.myfitbrain.app` | no |
| `RAZORPAY_KEY_ID` | Razorpay → API Keys → Key ID (`rzp_test_…` or `rzp_live_…`) | no* |
| `RAZORPAY_KEY_SECRET` | Razorpay → API Keys → Key Secret | **yes** |
| `RAZORPAY_WEBHOOK_SECRET` | the secret you typed when creating the webhook | **yes** |

\* The key ID is sent to the checkout by the server; it is not secret, but keep it server-side anyway.

### `mfb-admin`

| Variable | Value | Secret |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as above | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as above | no |
| `SUPABASE_SERVICE_ROLE_KEY` | same as above | **yes** |
| `NEXT_PUBLIC_CLIENTS_URL` | `https://app.myfitbrain.app` | no |
| `NEXT_PUBLIC_ADMIN_URL` | `https://admin.myfitbrain.app` | no |

After changing a variable, **redeploy** (Deployments → ⋯ → Redeploy): variables are read at build and
start-up.

---

## 4. Domains

Project → Settings → Domains:

- `mfb-clients` → add `app.myfitbrain.app`
- `mfb-admin` → add `admin.myfitbrain.app`

Vercel shows the DNS record to create at your domain registrar (usually a `CNAME` for `app` and
`admin` pointing to `cname.vercel-dns.com`). HTTPS certificates are issued automatically.

---

## 5. Supabase and Razorpay settings for production

**Supabase → Authentication → URL Configuration**

- Site URL: `https://app.myfitbrain.app`
- Redirect URLs: add `https://app.myfitbrain.app/**` and `https://admin.myfitbrain.app/**`

**Razorpay → Account & Settings → Webhooks** (create one in Test Mode now, and again in Live Mode
when you go live; each mode has its own keys and webhooks)

- URL: `https://app.myfitbrain.app/api/payments/webhook`
- Secret: a long random string (same value as `RAZORPAY_WEBHOOK_SECRET`)
- Events: `payment.captured`, `order.paid`, `payment.failed`

**Going live with payments:** switch Razorpay to Live Mode, generate live keys, create the live
webhook, put the `rzp_live_…` key, its secret and the live webhook secret in `mfb-clients`, redeploy.
No code changes.

---

## 6. After each production deploy (5-minute check)

1. `https://app.myfitbrain.app` → phone OTP login works.
2. Choose a test → **Pay ₹3,500** opens Razorpay (in test mode, pay with UPI `success@razorpay`).
3. After paying, the assessment opens; Admin → **Payments** shows the payment as Paid.
4. Razorpay → Webhooks → your webhook → recent deliveries show `200`.
5. `https://admin.myfitbrain.app` → staff login, a completed assessment's **Download PDF** works.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Cannot find module '@mfb/engine'` (or questionbank/report) during build | Install Command is not `cd .. && npm ci`, or "Include files outside the Root Directory" is off. |
| `npm ci` fails: lockfile out of sync | Run `npm install` at the repo root locally, commit `package-lock.json`. |
| Pages work but every request is slow | Function region far from the Supabase region (section 2). |
| Payment page says "Payments are not available right now" | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` missing in `mfb-clients`; redeploy after adding. |
| Webhook deliveries fail with `400` | `RAZORPAY_WEBHOOK_SECRET` differs from the secret in Razorpay. |
| Webhook deliveries fail with `503` | Razorpay keys not set in `mfb-clients`. |
| Report PDF download fails in admin | "Include files outside the Root Directory" is off (the PDF needs `brand/`). |
| Login loops back to the login page | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` wrong for this project, or Supabase redirect URLs missing. |

---

## Local commands

```bash
npm install                 # once, at the repo root (never inside an app)
npm run dev:clients         # http://localhost:3000
npm run dev:admin           # http://localhost:3001
npm run build               # both apps
npm run lint                # every workspace
npm test                    # every workspace with tests
```

On Windows, keep the clone in a short path (e.g. `D:\meda\…`): deep `node_modules` paths under a long
folder exceed the 260-character limit and the Next.js build fails. Vercel (Linux) is not affected.

## History of the apps

Until 2026-10-15, `admin/` and `clients/` were separate git repositories nested in this one. They were
merged into this repository as plain folders (commit `chore: merge apps into a single repository`); their
earlier commits are kept in `../git-backups/admin.git` and `../git-backups/clients.git`.
