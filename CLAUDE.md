# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Scrollingo is a language-learning short-form video app. The repo is a monorepo with three distinct components that do not share a build system:

- `mobile/` — React Native + Expo SDK 55 app (TypeScript). This is the primary product.
- `scripts/` — Standalone Python content pipeline (OCR + STT + LLM definitions → Supabase + Cloudflare R2). Run ad-hoc from the repo root; not part of any server.
- `app.py` + `templates/index.html` — A separate Flask dev tool for downloading TikTok/Douyin videos into `downloads/` so they can be fed into `scripts/pipeline.py`. Unrelated to the mobile app runtime.
- `docs/phase1_architecture.md` and `docs/database_design.md` — Authoritative design docs. When the architecture is unclear, read these before guessing.

There is no Go backend yet. The mobile app talks to Supabase directly via `@supabase/supabase-js` + PostgREST + RLS. A Go backend is planned as milestone M10.

## Commands

All Jest/TypeScript work happens in `mobile/`. The root `package.json` forwards `test` into `mobile/` and hosts Husky.

```bash
# Mobile app
cd mobile
npm start                                 # Expo dev server
npm run ios | npm run android | npm run web
npm run format                            # prettier **/*.{ts,tsx} --write
npm test                                  # jest (jest-expo preset)
npm run test:coverage                     # jest --coverage (coverage thresholds enforced)
npx jest path/to/file.test.tsx            # single test file
npx jest -t "test name substring"         # single test by name

# From repo root
npm test                                  # proxies to `cd mobile && npx jest`

# Python content pipeline (from repo root — loads .env from there)
python3 scripts/pipeline.py --video ~/downloads/video.mp4
python3 scripts/pipeline.py --video v.mp4 --language zh --title "My Title"
python3 scripts/pipeline.py --video v.mp4 --dry-run       # skip R2 + Supabase writes
python3 scripts/pipeline.py --video v.mp4 --force-stt     # skip OCR detection

# Flask downloader tool (unrelated to mobile runtime)
pip install -r requirements.txt
python app.py                             # http://localhost:5000
```

### Coverage & Husky

`.husky/pre-commit` runs `cd mobile && npx jest --coverage` **only when committing to `main`**. On feature branches the hook exits 0, so local commits do not run tests. Coverage thresholds (in `mobile/package.json`) are branches 15 / functions 20 / lines 25 / statements 25. Running `npm run test:coverage` locally is the way to reproduce the main-branch gate.

## Architecture: mobile app

### Entry point & providers (`mobile/App.tsx`)

Wraps everything in `GestureHandlerRootView` → Redux `Provider` → `QueryClientProvider` → `<Route />`. The QueryClient is configured with `staleTime: Infinity` and `refetchInterval: false` by default — hooks that need fresher data (e.g. `useFeed` sets a 5-minute `staleTime`) override this per-query.

### Two-layer state

- **Redux Toolkit** (`src/redux/store.ts`) holds global app state in five slices: `auth`, `post`, `modal`, `chat`, `language`. `serializableCheck` is disabled.
- **React Query v5** holds server cache. Query keys are centralized in `src/hooks/queryKeys.ts` — always add new keys there rather than inlining strings.

These two systems are **not interchangeable**: Redux is for auth, language preferences, modal state, and anything consumed synchronously by navigators; React Query is for paginated/async server data (feed, flashcards, subtitles, word definitions, user profile by ID, follow state).

### Navigation gating (`src/navigation/main/index.tsx`)

The root stack uses a two-gate pattern driven by Redux:

1. If `auth.currentUser == null` → render only the `auth` screen.
2. Else if `language.onboardingComplete === false` → render only the `onboarding` screen.
3. Else → render the full app stack (`home` tab nav + modal screens).

A blank black view is shown while `auth.loaded` is false OR (user is signed in AND `language.loaded` is false). Both slices must resolve before the navigator mounts. `userAuthStateListener` (authSlice) and `loadLanguages` (languageSlice) are dispatched from this component.

Inside `home`, `src/navigation/home/index.tsx` is a `material-bottom-tabs` navigator with five tabs: `feed`, `Discover`, `Review`, `Inbox`, `Me`.

### Auth slice pattern (`src/redux/slices/authSlice.ts`)

`userAuthStateListener` dispatches `setUserState` **twice**: first with a minimal user built from Supabase auth metadata (`mapSupabaseUser`), then again with the full DB profile from the `users` table (`loadFullProfile`). This keeps the UI responsive while the profile fetch resolves, and falls back to the auth-metadata user if the DB call fails (common on simulators with flaky network). When adding fields to the `User` type, update both `mapSupabaseUser` defaults and the DB fetch path.

### Supabase client (`src/lib/supabase.ts`)

Uses `expo-secure-store` as the auth storage adapter — sessions persist in the iOS Keychain / Android Keystore. Reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from env. `detectSessionInUrl` is false (we handle OAuth callbacks manually).

### Feed architecture

`useFeed(language)` (src/hooks/useFeed.ts) is a `useInfiniteQuery` keyed on the active learning language. `fetchFeedPage` does cursor pagination against Supabase (keyset on `created_at + id`). The feed screen (`src/screens/feed/index.tsx`) drives a `FlatList` with viewability tracking to pause/play the active video. See `docs/phase1_architecture.md §3.2` for the playback optimization strategy (thumbnail placeholders, prefetch N+1/N+2, <200ms TTF).

### FSRS flashcards

The `ts-fsrs` package schedules every review. Flashcards store full FSRS state (`state`, `stability`, `difficulty`, `due`, `reps`, `lapses`, `learning_steps`) — see the `Flashcard` interface in `mobile/types/index.ts`. The DB row shape includes joined fields (`word`, `pinyin`, `translation`, `contextual_definition`, `part_of_speech`) that come from `vocab_words` + `word_definitions`. When touching flashcard code, keep the FSRS fields aligned with the `ts-fsrs` Card interface.

### Inherited code from kirkwat/tiktok

Files flagged with a top comment `// INHERITED: This file is from the kirkwat/tiktok base repo.` have not yet been rewritten for Scrollingo. Examples: `src/services/posts.ts` (still uses local `require()`'d video assets and hard-coded seed creator UUIDs), `src/hooks/queryKeys.ts`, `src/navigation/home/index.tsx`. **Do not assume these follow Scrollingo patterns — verify behavior before modifying, and when rewriting, drop the `INHERITED` comment.**

## Testing conventions

- **Preset**: `jest-expo`. Tests colocate in `__tests__/` folders next to source (`src/screens/**/__tests__`, `src/redux/slices/__tests__`, `src/services/__tests__`) plus app-wide tests in `src/__tests__/{integration,regression}/`.
- **Mocks at `mobile/__mocks__/`**: Module-level mocks for `react-redux`, `expo-video`, `expo-linear-gradient`, `react-native-paper`, `react-native-safe-area-context`, plus directories `@expo`, `@gorhom`, `@react-navigation`. Jest picks these up automatically — you usually don't need to `jest.mock()` these modules in individual test files. The `react-redux` mock provides a default `useSelector` state shape that tests can override via `jest.mocked(useSelector).mockImplementation(...)`.
- **transformIgnorePatterns** in `mobile/package.json` is curated — when adding a new RN library that ships untranspiled ESM, add it to that allowlist or tests will fail with a syntax error in `node_modules`.
- **Coverage excludes** `styles.ts`, `types.ts`, and anything under `__tests__/`.
- The `.vscode/launch.json` provides "Jest: Run Current File" and "Jest: Run with Debugger" launch configs that `cd` into `mobile/` automatically.

## Python pipeline (`scripts/pipeline.py`)

Loads `.env` from the repo root. Required env vars: `OpenrouterAPIKey`, `SupabaseUrl`, `SupabaseServiceKey`, plus `R2BucketUrl`/`R2Endpoint`/`R2AccessKeyId`/`R2SecretAccessKey`/`R2BucketName`. `GroqAPIKey` is required only for the STT path.

Pipeline flow (see `docs/phase1_architecture.md §5.4` for details):

1. FFmpeg normalize → 720p progressive MP4
2. Detect subtitle source (sample frames for burned-in text) → OCR path (VideOCR + PP-OCRv5, SSIM dedup) or STT path (Groq Whisper)
3. Auto-detect language + title from extracted text if not provided
4. Upload `video.mp4`, `thumbnail.jpg`, `bboxes.json` to R2 (`scrollingo-media` bucket)
5. Insert row in `videos` (status=`processing`)
6. Word segmentation (jieba for Chinese, whitespace otherwise)
7. Claude Haiku 3.5 via OpenRouter generates translation + contextual definition + POS per word × 11 target languages (localized prompts)
8. Batch upsert `vocab_words`, `word_definitions`, `video_words`
9. Mark video `ready`, log `pipeline_jobs` row

If any Supabase insert fails mid-run, the pipeline cleans up partial rows and re-raises. Related scripts (`extract_subtitles_*.py`, `comparison_dashboard.py`) are experiments used to pick the OCR model — the production path is `extract_subtitles_videocr2.py` (VideOCR SSIM), which is already integrated into `pipeline.py`.

`scripts/test_pipeline.py` is a pytest suite (~48 tests) for the pipeline — run with `pytest scripts/test_pipeline.py` from the repo root.

## Conventions & gotchas

- **No path aliases** — all imports in `mobile/` are relative (`../../types`, `../../services/foo`). `tsconfig.json` only extends `expo/tsconfig.base` with `strict: true`.
- **Types live in `mobile/types/index.ts`** (one directory up from `src/`), so screens import from `../../../types`. Don't move this file without updating every screen.
- **Language direction is always video → native** (see architecture doc §4.3). Never guess lookup direction from context.
- **`staleTime: Infinity` default** means mutations must explicitly `invalidateQueries` — don't rely on time-based refetch.
- **Redux `serializableCheck` is disabled** — thunks sometimes pass non-serializable values. Don't add serializable-check middleware back without auditing all actions.
