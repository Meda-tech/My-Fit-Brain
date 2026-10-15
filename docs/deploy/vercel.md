# Deploying to Vercel (npm workspaces monorepo)

The repo is an npm workspaces monorepo: `clients/`, `admin/` and `packages/*` (today
`packages/questionbank`, imported by both apps as TypeScript source). There is one lockfile, at the
repo root. Each app is its own Vercel project.

## Projects

| Setting | Client portal | Staff portal |
|---|---|---|
| Project | `mfb-clients` | `mfb-admin` |
| Root Directory | `clients` | `admin` |
| Include files outside the root directory in the Build Step | **ON** | **ON** |
| Framework preset | Next.js | Next.js |
| Install Command | `cd .. && npm ci` | `cd .. && npm ci` |
| Build Command | `npm run build` (default) | `npm run build` (default) |
| Output | default (`.next`) | default (`.next`) |
| Domain | `app.myfitbrain.app` | `admin.myfitbrain.app` |
| Node.js | 20.x or later | 20.x or later |

"Include files outside the root directory" lets the build read `packages/questionbank` and the root
`package-lock.json`. Installing from the repo root (`cd .. && npm ci`) installs every workspace and
links `@mfb/questionbank` into `node_modules`. `next.config.ts` sets `turbopack.root` to the repo root
and lists `@mfb/questionbank` in `transpilePackages`.

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
variables only matter where an app builds a full link (payments, notifications), from Phase 2.

## Local commands

```bash
npm install                 # once, at the repo root
npm run dev:clients         # http://localhost:3000
npm run dev:admin           # http://localhost:3001
npm run build               # both apps
npm run lint                # every workspace
npm test                    # every workspace with tests (today: @mfb/questionbank)
```

## Before the first deploy: nested git repositories

Today `admin/` and `clients/` are separate git repositories inside the root repository, recorded only
as gitlinks (there is no `.gitmodules`). A fresh clone of the root repo — which is what Vercel does —
gets empty `admin/` and `clients/` folders, and a clone of an app repo has no `packages/` or root
lockfile. Neither builds on its own.

Pick one before connecting Vercel:
1. **One repository (recommended):** fold `admin/` and `clients/` into the root repo (keeping their
   history with `git subtree add` or a `git filter-repo` merge), then point both Vercel projects at it.
2. **Submodules:** register both apps as real submodules (`.gitmodules`) and enable submodule checkout
   on Vercel. The root repo then pins exact app commits.
