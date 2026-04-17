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

`FeedScreen` is **dual-mode**, keyed on `route.params.profile`:
- **Feed mode** (`profile=false`, default) — paginated `useFeed(activeLearningLanguage)`.
- **Profile mode** (`profile=true`) — single `useQuery(["userVideos", creator])` via `fetchVideosByCreator`. Entered via the `userPosts` stack route pushed from profile post grids.

Viewability callbacks (`onViewableItemsChanged`) call `cell.play()`/`cell.stop()` on per-item `PostSingleHandles` refs and fire `trackView(userId, videoId)` **once per session** (gated by a `viewedVideos` ref Set, upserted on the server side against `user_views`). A separate `isFocused` effect stops every cell when the tab blurs and resumes the last-viewable cell on refocus. `LanguageDropdown` is conditionally rendered only when `learningLanguages.length >= 2`; picking a language both dispatches `setActiveLearningLanguage` (Redux, synchronous) and calls `updateActiveLanguage(userId, code)` (Supabase, fire-and-forget).

### Subtitle/transcript three-tier system

Every video has up to three JSON artifacts in R2 alongside `video.mp4`, and they are **used for different UI purposes**:

| File | Purpose | Hook |
|------|---------|------|
| `bboxes.json` | OCR bounding boxes for invisible per-character tap targets over burned-in text | `useSubtitles(videoId, cdnUrl)` |
| `stt.json` | Word-level STT timing, fallback-only | `useSttSubtitles(...)` |
| `transcript.json` | Merged OCR text + STT timing (spoken lines only; title cards filtered) | `useTranscript(...)` |

`fetchTranscriptData` in `src/services/subtitles.ts` hard-codes a **transcript.json → stt.json → bboxes.json** fallback chain. The URLs are derived by string replacement from `cdn_url` (take everything up to the last `/`, append the filename) — no separate field on the video row. `PostSingle` (`src/components/general/post/index.tsx`) fetches **both** `useSubtitles` (for tap targets) and `useTranscript` (for the subtitle drawer), and falls back to OCR for the drawer if transcript is missing.

For local dev videos, `getLocalSubtitleData(postId)` reads from bundled `mobile/assets/subtitles/video_N_dense.json`. Those bundled files coexist with many other `_videocr`/`_videocr2`/`_rapid`/`_pipeline`/`_stt`/`_transcript` variants — these exist only to feed the `devOcrCompare` screen and are not used by production code paths.

### Word definitions (2-query JS join)

`fetchWordDefinitions(videoId, targetLanguage)` in `src/services/wordDefinitions.ts` deliberately issues **two separate queries** (`video_words` + nested `vocab_words`, then `word_definitions`) and joins them in JS via a `Map` keyed by `vocab_word_id`. The comment at the top explains why: PostgREST FK joins across sibling tables are fragile. Do not "optimize" this into a single query without testing against Supabase.

### Modal system (single global bottom sheet)

`src/components/modal/index.tsx` mounts one `@gorhom/bottom-sheet` at the root of `NavigationContainer`. `modalSlice.openCommentModal` payload carries `{ open, data, modalType, onCommentSend }`. The component's `switch(modalState.modalType)` only handles `case 0` (the comment modal); any new modal adds a new numeric type and a new case. The `onCommentSend` callback in Redux state is a function — this is why `serializableCheck` is disabled.

### Review screen: session queue + re-queue

`src/screens/review/CardViewer.tsx` builds a local `queue: Flashcard[]` from the initial `useFlashcards` result (limited by `auth.currentUser.maxReviewsPerDay`). On each rating:

1. Build a `ts-fsrs` Card from stored FSRS fields, call `scheduler.repeat(card, now)[rating]`.
2. Persist via `Promise.all([updateFlashcardAfterReview, logReview])`.
3. **Re-queue rule**: if the new `due` is within 10 minutes AND the card hasn't been re-queued already (`requeuedSet` ref), push it to the back of the queue. `ProgressBar` counts **unique** cards only, not re-queue passes.
4. When the queue drains, invalidate `keys.flashcards(lang)` + `keys.flashcardCount(lang)` and transition to `SessionComplete`.

The parent `src/screens/review/index.tsx` is a small state machine: `ReviewHub` → `CardViewer` → `SessionComplete`, plus a side-route to `VocabList`.

### Chat is still a mock

`src/services/chat.ts`, `src/hooks/useChats.ts`, and `src/redux/slices/chatSlice.ts` are all `INHERITED` and backed by in-memory mock data + `setTimeout` "listeners". `useChats()` is called from `src/navigation/home/index.tsx` on mount — subscribing it to a real Supabase Realtime channel is pending.

### Dev toggles

`languageSlice.devMuted` (toggled from `src/screens/settings/index.tsx`) is read by `PostSingle` to force-mute the active video. `src/screens/devOcrCompare/index.tsx` is a reachable-only-from-settings developer screen that side-by-side compares bundled OCR variants against each bundled test video — it explains the large number of `video_N_*.json` files under `mobile/assets/subtitles/`.

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
2. Detect subtitle source by sampling 3 frames (25/50/75%) — if ≥2 have high-confidence text, take the OCR path; otherwise STT
3. OCR path imports from `scripts/extract_subtitles_dense.py` (PaddleOCR PP-OCRv5 with SSIM dedup on the subtitle region). The other `extract_subtitles_*.py` variants (`baseline`, `videocr`, `videocr2`, `rapid`) are kept only so the in-app `devOcrCompare` screen and `docs/phase1_architecture.md` comparison can reproduce historical outputs — **do not edit them expecting pipeline changes**.
4. STT path: extract audio → Groq Whisper → word-level timestamps; `chunk_stt_segments` splits by visual width (CJK chars count as 2).
5. Unified pipeline produces **three artifacts** uploaded to R2: `bboxes.json` (OCR boxes for tap targets), `stt.json` (STT-only fallback), and `transcript.json` (merged OCR text + STT timing, spoken-only). Also `video.mp4` + `thumbnail.jpg`.
6. Auto-detect language + title from extracted text if not passed via `--language` / `--title`.
7. Insert row in `videos` (status=`processing`).
8. Word segmentation (jieba for Chinese with `pypinyin` for tones, whitespace otherwise).
9. Claude Haiku 3.5 via OpenRouter generates translation + contextual definition + POS per word × 11 target languages (localized prompts — prompt labels are themselves translated per target).
10. Batch upsert `vocab_words`, `word_definitions`, `video_words`.
11. Mark video `ready`, log `pipeline_jobs` row.

If any Supabase insert fails mid-run, the pipeline cleans up partial rows and re-raises.

`scripts/reprocess_videos.py` is a companion that **only** re-runs OCR/STT/merge and re-uploads the three JSON artifacts to R2 for existing video rows — useful after changing subtitle formats without regenerating definitions. `scripts/test_pipeline.py` is a pytest suite (~48 tests) — run with `pytest scripts/test_pipeline.py` from the repo root.

`cost_estimator.py` at the repo root (~2.9K lines) is a standalone Streamlit dashboard for AI cost modeling (STT/TTS/LLM/transcode price comparison). Not part of any runtime; `streamlit run cost_estimator.py` to open it.

## Conventions & gotchas

- **No path aliases** — all imports in `mobile/` are relative (`../../types`, `../../services/foo`). `tsconfig.json` only extends `expo/tsconfig.base` with `strict: true`.
- **Types live in `mobile/types/index.ts`** (one directory up from `src/`), so screens import from `../../../types`. Don't move this file without updating every screen.
- **Language direction is always video → native** (see architecture doc §4.3). Never guess lookup direction from context.
- **`staleTime: Infinity` default** means mutations must explicitly `invalidateQueries` — don't rely on time-based refetch. Follow the existing pattern: mutations hit `queryClient.invalidateQueries({ queryKey: keys.xyz(lang) })` for **every** affected key (e.g. `useSaveFlashcard` invalidates both `flashcards(lang)` and `flashcardCount(lang)`).
- **Redux `serializableCheck` is disabled** — thunks sometimes pass non-serializable values (e.g. the `onCommentSend` callback on the modal slice). Don't add serializable-check middleware back without auditing all actions.
- **`language.fetchUserLanguages` uses a 5 s `AbortController`** to prevent hanging on flaky networks; it throws on abort. The navigation gate treats a rejected `loadLanguages` as "show onboarding" rather than blocking the app.
- **Feed keyset cursors** are `{ created_at, id }` tuples. `fetchFeedPage` only filters on `created_at` (strict less-than) with a secondary order on `id` for deterministic tie-breaking — don't simplify to OFFSET.
- **`metro.config.js` adds `cjs`** to `resolver.sourceExts` (required by some deps); `babel.config.js` includes `react-native-reanimated/plugin` (must remain last in its plugin list). Keep both.
- **Bundled mock data**: `src/services/posts.ts` still `require()`s ten local MP4s from `assets/videos/` and pairs them with four hardcoded seed creator UUIDs in Supabase — changing these requires matching DB rows to exist.
