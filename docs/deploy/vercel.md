# Deploying to Vercel (single repository, npm workspaces)

One git repository holds everything: `clients/`, `admin/` and `packages/*` (today
`packages/questionbank`, imported by both apps as TypeScript source). There is one lockfile, at the repo
root. Each app is its own Vercel project, both connected to the same repository.

## Projects

| Setting | Client portal | Staff portal |
|---|---|---|
| Project | `mfb-clients` | `mfb-admin` |
| Git repository | this repository | this repository |
| Root Directory | `clients` | `admin` |
| Include files outside the root directory in the Build Step | **ON** | **ON** |
| Framework preset | Next.js | Next.js |
| Install Command | `cd .. && npm ci` | `cd .. && npm ci` |
| Build Command | `npm run build` (default) | `npm run build` (default) |
| Output | default (`.next`) | default (`.next`) |
| Domain | `app.myfitbrain.app` | `admin.myfitbrain.app` |
| Node.js | 20.x or later | 20.x or later |

- "Include files outside the root directory" lets the build read `packages/` and the root
  `package-lock.json`.
- Installing from the repo root (`cd .. && npm ci`) installs every workspace and links
  `@mfb/questionbank` into `node_modules`. `next.config.ts` sets `turbopack.root` to the repo root and lists
  the package in `transpilePackages`.
- To build only when relevant files change, set each project's **Ignored Build Step** to
  `git diff --quiet HEAD^ HEAD -- . ../packages ../package-lock.json` (run from the Root Directory).

## Environment variables (per project)

Both projects:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (server only, never `NEXT_PUBLIC_`) |
| `NEXT_PUBLIC_CLIENTS_URL` | `https://app.myfitbrain.app` |
| `NEXT_PUBLIC_ADMIN_URL` | `https://admin.myfitbrain.app` |

Set them for Production and Preview. Preview deployments use their own `*.vercel.app` hosts; the URL
variables matter where an app builds a full link (payments, notifications), from Phase 2.

## Local commands

```bash
npm install                 # once, at the repo root (never inside an app)
npm run dev:clients         # http://localhost:3000
npm run dev:admin           # http://localhost:3001
npm run build               # both apps
npm run lint                # every workspace
npm test                    # every workspace with tests
```

A fresh clone was checked on 2026-10-15: `git clone` → `npm install` → `npm run build`, `npm run lint`
and `npm test` all pass. On Windows, keep the clone in a short path (e.g. `D:\meda\…`): deep
`node_modules` paths under a long folder such as `C:\Users\…\AppData\Local\Temp\…` exceed the 260-character
path limit and the Next.js build fails while prerendering. Vercel (Linux) is not affected.

## History of the apps

Until 2026-10-15, `admin/` and `clients/` were separate git repositories nested in this one. They were
merged into this repository as plain folders (commit `chore: merge apps into a single repository`); their
earlier commits are kept in `../git-backups/admin.git` and `../git-backups/clients.git`
(`git --git-dir=../git-backups/admin.git log` to read them).
