import streamlit as st
import math

# --- Pricing & Core Logic Constants ---
# Last verified: March 2026. See pricing sources at bottom of dashboard.

# === AI Provider Pricing ===
# STT Providers
STT_PRICING = {
    "OpenAI Whisper": 0.006,           # $/minute
    "Groq Whisper (Turbo)": 0.000667,  # $/minute (~9x cheaper)
    "Google Speech-to-Text": 0.004,    # $/minute (standard model)
    "Deepgram Nova-2": 0.0043,         # $/minute
}

# TTS Providers
TTS_PRICING = {
    "ElevenLabs (Scale)": 0.165,       # $/1K chars
    "Google Cloud Neural2": 0.016,     # $/1K chars (~10x cheaper)
    "Amazon Polly Neural": 0.016,      # $/1K chars
    "Azure Neural TTS": 0.016,         # $/1K chars
    "On-Device Only": 0.0,             # Free (Expo Speech/TTS plugin)
}

# Translation Providers
TRANSLATION_PRICING = {
    "Google Translate API": 20.0,      # $/million chars
    "DeepL API Pro": 25.0,             # $/million chars
    "Self-Hosted (NLLB)": 0.0,         # Free (requires GPU compute)
}

# Contextual Definition LLM Providers (per 1M tokens: input / output)
LLM_PRICING = {
    "Gemini 2.0 Flash": (0.10, 0.40),
    "GPT-4o Mini": (0.15, 0.60),
    "Llama 3.3 70B (Groq)": (0.59, 0.79),
    "Claude 3.5 Haiku": (0.80, 4.00),
    "GPT-4o": (2.50, 10.00),
    "Claude 4 Sonnet": (3.00, 15.00),
}

# Batch definition generation: ~1,590 input + ~1,500 output tokens per video per language
LLM_INPUT_TOKENS_PER_VIDEO = 1590
LLM_OUTPUT_TOKENS_PER_VIDEO = 1500

# === Transcoding Strategy Pricing ===
TRANSCODE_STRATEGIES = {
    "Full HLS (4 renditions)": {
        "rate_per_min": 0.0105,  # AWS MediaConvert blended SD/HD
        "renditions": 4,
        "description": "Full adaptive bitrate: 360p, 480p, 720p, 1080p via MediaConvert",
    },
    "Client Compress + Progressive MP4": {
        "rate_per_min": 0.0,
        "renditions": 1,
        "description": "Client compresses to 720p, serve as progressive MP4 (no server transcoding)",
    },
    "Delayed Transcoding (>100 views)": {
        "rate_per_min": 0.0105,
        "renditions": 4,
        "transcode_percent": 0.20,  # Only 20% of videos exceed 100 views
        "description": "Serve original first, only transcode popular videos (80% skip rate)",
    },
    "Mux (Managed)": {
        "rate_per_min": 0.0075,  # Per source minute, all renditions included
        "renditions": 1,  # Mux charges per source minute
        "description": "Mux handles all renditions at $0.0075/source-minute",
    },
    "Cloudflare Stream": {
        "rate_per_min": 0.005,   # $5/1000 minutes stored + $1/1000 minutes delivered
        "renditions": 1,
        "description": "Cloudflare Stream: $5/1K min stored + $1/1K min delivered",
    },
}

# === Storage ===
PRICE_PER_GB_STORAGE = 0.015               # Cloudflare R2
PRICE_PER_MILLION_WRITE_OPS = 4.50          # Cloudflare R2 (Class A Operations)
PRICE_PER_MILLION_READ_OPS = 0.36           # Cloudflare R2 (Class B Operations)

# === Revenue ===
AD_IMPRESSION_THRESHOLD = 2000000           # AdSense for Video eligibility
APP_STORE_COMMISSION_RATE = 0.15            # Apple/Google Small Business Program (year 2+)
CDN_CACHE_HIT_RATE = 0.90                   # Cloudflare CDN estimated cache hit rate
AD_FILL_RATE = 0.20                         # Show ad every ~5 videos
AD_PROGRAMMATIC_FILL = 0.70                 # % of ad slots that fill programmatically

# === TTS Caching (Zipf's Law) ===
TTS_CACHE_REDUCTION = 0.67                  # Top 10K words cover 95-97% of requests

# === Lean Mode Hard Limits ===
LEAN_MODE_MAX_MAU = 100_000                 # Above this, lean infra can't handle the load
# Free tier breakpoints (videos/month thresholds)
GROQ_MAX_VIDEOS_PER_MONTH = 60_000          # 2K requests/day * 30 days
GOOGLE_TTS_FREE_CHARS = 1_000_000           # Neural2 free tier chars/month
GOOGLE_TRANSLATE_FREE_CHARS = 500_000       # Translation free tier chars/month
SENTRY_FREE_ERRORS = 5_000                  # Free tier errors/month
SUPABASE_PRO_AUTH_MAU = 100_000             # Included in Pro, then $0.00325/MAU overage
R2_FREE_STORAGE_GB = 10                     # Free tier storage


# --- Calculation Functions ---
def calculate_financials(
    mau, dau_percent, upload_percent, video_length_sec,
    sub_price, sub_percent, ad_rpm, data_consumption_gb,
    lean_mode=False, user_uploads_enabled=True, seeded_videos_per_month=100,
    stt_provider="OpenAI Whisper", tts_provider="ElevenLabs (Scale)",
    translation_provider="Google Translate API",
    transcode_strategy="Full HLS (4 renditions)",
    tts_caching_enabled=False,
    on_device_realtime=False,
    total_platform_videos=0,
    llm_provider="Gemini 2.0 Flash",
    num_target_languages=12,
):
    """Calculates all cost, revenue, and profit components."""

    cost_keys = [
        "media_processing", "storage_delivery", "database",
        "compute_recommendation", "platform_ops", "total"
    ]
    costs = {}
    cost_detail = {}
    warnings = []  # Track free tier / capacity warnings

    if mau == 0:
        costs = {key: 0 for key in cost_keys}
        cost_detail = {}
    else:
        # User & Content Metrics
        dau = mau * (dau_percent / 100.0)
        chars_per_video = (video_length_sec / 30.0) * 400

        if user_uploads_enabled:
            videos_per_month = dau * (upload_percent / 100.0) * 30
        else:
            videos_per_month = seeded_videos_per_month

        # --- Media Processing ---
        # Transcoding
        strategy = TRANSCODE_STRATEGIES[transcode_strategy]
        video_minutes = videos_per_month * (video_length_sec / 60.0)

        if transcode_strategy == "Client Compress + Progressive MP4":
            transcode_cost = 0
        elif transcode_strategy == "Delayed Transcoding (>100 views)":
            transcode_percent = strategy.get("transcode_percent", 0.20)
            transcode_cost = (video_minutes * transcode_percent
                              * strategy["renditions"] * strategy["rate_per_min"])
        elif transcode_strategy in ("Mux (Managed)", "Cloudflare Stream"):
            transcode_cost = video_minutes * strategy["rate_per_min"]
        else:
            transcode_cost = (video_minutes * strategy["renditions"]
                              * strategy["rate_per_min"])

        # STT
        stt_rate = STT_PRICING[stt_provider]
        stt_cost = videos_per_month * (video_length_sec / 60.0) * stt_rate

        # TTS — vocab word pronunciation only (videos already have audio)
        # Pre-generated per LEARNING language (en, zh), not per native language
        # One-time cost ~$11.20/language, then $0 ongoing TTS API cost
        num_learning_languages = 2  # Phase 1: English + Chinese
        if tts_provider == "On-Device Only":
            tts_cost = 0
        else:
            tts_storage_gb = num_learning_languages * 0.95
            tts_cost = tts_storage_gb * PRICE_PER_GB_STORAGE  # R2 storage only

        # Translation
        translate_rate = TRANSLATION_PRICING[translation_provider]
        translate_cost = (videos_per_month * chars_per_video / 1_000_000) * translate_rate

        # Contextual Definitions (LLM) — per word, per video, per target language
        # Batch mode: ~1,590 input + ~1,500 output tokens per video per language
        llm_input_price, llm_output_price = LLM_PRICING[llm_provider]
        input_cost_per_video = (LLM_INPUT_TOKENS_PER_VIDEO / 1_000_000) * llm_input_price
        output_cost_per_video = (LLM_OUTPUT_TOKENS_PER_VIDEO / 1_000_000) * llm_output_price
        definitions_cost = (input_cost_per_video + output_cost_per_video) * videos_per_month * num_target_languages

        costs["media_processing"] = transcode_cost + stt_cost + tts_cost + translate_cost + definitions_cost
        cost_detail["transcode"] = transcode_cost
        cost_detail["stt"] = stt_cost
        cost_detail["tts"] = tts_cost
        cost_detail["translate"] = translate_cost
        cost_detail["definitions"] = definitions_cost

        # --- Storage & Delivery (R2 + CDN) ---
        if transcode_strategy == "Client Compress + Progressive MP4":
            mb_per_video_stored = (video_length_sec / 30.0) * 8  # Single 720p rendition ~8MB
        elif transcode_strategy in ("Mux (Managed)", "Cloudflare Stream"):
            mb_per_video_stored = 0  # Managed storage included
        else:
            mb_per_video_stored = (video_length_sec / 30.0) * 25  # 4 renditions

        total_videos_stored = total_platform_videos if total_platform_videos > 0 else videos_per_month * 12
        total_gb_stored = (total_videos_stored * mb_per_video_stored) / 1024
        storage_cost = total_gb_stored * PRICE_PER_GB_STORAGE

        if transcode_strategy in ("Mux (Managed)", "Cloudflare Stream"):
            # Storage included in managed service
            write_ops_cost = 0
        else:
            renditions = 1 if transcode_strategy == "Client Compress + Progressive MP4" else 4
            objects_per_upload = renditions + 2
            write_ops_millions = (videos_per_month * objects_per_upload) / 1_000_000
            write_ops_cost = write_ops_millions * PRICE_PER_MILLION_WRITE_OPS

        avg_mb_per_view = (video_length_sec / 30.0) * 15
        views_per_user = (data_consumption_gb * 1024) / avg_mb_per_view if avg_mb_per_view > 0 else 0
        total_views = mau * views_per_user

        if transcode_strategy in ("Mux (Managed)", "Cloudflare Stream"):
            read_ops_cost = 0  # Delivery included
            # Managed streaming delivery cost
            if transcode_strategy == "Cloudflare Stream":
                delivery_minutes = total_views * (video_length_sec / 60.0)
                managed_delivery_cost = delivery_minutes * 0.001  # $1/1K min
            else:
                managed_delivery_cost = 0  # Mux includes delivery
        else:
            r2_reads = total_views * (1 - CDN_CACHE_HIT_RATE)
            read_ops_millions = r2_reads / 1_000_000
            read_ops_cost = read_ops_millions * PRICE_PER_MILLION_READ_OPS
            managed_delivery_cost = 0

        costs["storage_delivery"] = storage_cost + write_ops_cost + read_ops_cost + managed_delivery_cost

        # --- Infrastructure ---
        if lean_mode:
            # Supabase Pro: $25/mo base, compute addons for scale
            # Auth: 100K MAU included, then $0.00325/MAU overage
            if mau <= 10_000:
                db_base = 25                         # Supabase Pro (Nano compute included)
            elif mau <= 50_000:
                db_base = 25 + 50                    # Pro + Medium compute addon ($50)
            elif mau <= 100_000:
                db_base = 25 + 100                   # Pro + Large compute addon ($100)
            else:
                db_base = 25 + 100
                warnings.append(f"Supabase Pro connection limits (~200 pooled) may throttle at {mau:,} MAU. Consider migrating to dedicated PostgreSQL.")

            # Auth overage beyond 100K MAU
            auth_overage = max(0, mau - SUPABASE_PRO_AUTH_MAU) * 0.00325
            if auth_overage > 0:
                warnings.append(f"Supabase Auth overage: {mau - SUPABASE_PRO_AUTH_MAU:,} MAU beyond 100K free = ${auth_overage:,.0f}/mo")

            costs["database"] = db_base + auth_overage

            # Compute: fly.io shared CPU (Go monolith)
            if mau <= 5_000:
                costs["compute_recommendation"] = 5    # shared-cpu-2x 512MB
            elif mau <= 25_000:
                costs["compute_recommendation"] = 15   # shared-cpu-4x 1GB
            elif mau <= 50_000:
                costs["compute_recommendation"] = 60   # performance-1x dedicated 2GB
            elif mau <= 100_000:
                costs["compute_recommendation"] = 125  # performance-2x dedicated 4GB
            else:
                costs["compute_recommendation"] = 250  # 2x performance-2x (HA)
                warnings.append(f"fly.io shared CPU is unreliable at {mau:,} MAU. Dedicated CPU required ($62+/mo per instance). Consider migrating to managed Kubernetes or ECS.")

            # Platform ops: free tiers with stepped upgrades
            monitoring_cost = 0   # Axiom free (500GB/mo) + Grafana Cloud free
            sentry_cost = 0       # Sentry free (5K errors/mo)
            cdn_cost = 0          # Cloudflare free plan (R2 egress = free CDN)
            auth_service_cost = 0 # Supabase Auth (included in DB cost above)

            # Sentry: free tier breaks at ~25K-50K MAU (assuming 0.5% error rate)
            estimated_errors = mau * 0.005 * 20 * 0.005  # MAU * error_rate * sessions/user * errors/session
            if estimated_errors > SENTRY_FREE_ERRORS:
                sentry_cost = 26  # Sentry Team plan
                if mau <= 50_000:
                    warnings.append(f"Sentry free tier (5K errors/mo) likely exceeded at {mau:,} MAU. Upgrade to Team plan ($26/mo).")

            # Cloudflare: Pro at 50K+ for better WAF, Business at 250K+
            if mau >= 50_000:
                cdn_cost = 20     # Cloudflare Pro
            if mau >= 250_000:
                cdn_cost = 200    # Cloudflare Business

            costs["platform_ops"] = monitoring_cost + sentry_cost + cdn_cost + auth_service_cost

            # --- Free Tier Warnings ---
            # Groq rate limits
            if stt_provider == "Groq Whisper (Turbo)" and videos_per_month > GROQ_MAX_VIDEOS_PER_MONTH:
                warnings.append(f"Groq API rate limit: {videos_per_month:,.0f} videos/mo exceeds ~{GROQ_MAX_VIDEOS_PER_MONTH:,}/mo capacity (2K requests/day). Need Groq enterprise plan or fallback STT provider.")

            # Google TTS: no ongoing API cost (all words pre-generated in R2)
            # One-time generation cost: ~$11.20/language (not modeled as monthly)

            # Google Translate free tier
            if translation_provider == "Google Translate API":
                total_translate_chars = videos_per_month * chars_per_video
                if total_translate_chars > GOOGLE_TRANSLATE_FREE_CHARS:
                    free_savings_t = GOOGLE_TRANSLATE_FREE_CHARS / 1_000_000 * TRANSLATION_PRICING["Google Translate API"]
                    warnings.append(f"Google Translate free tier (500K chars/mo) exceeded at {videos_per_month:,.0f} videos/mo. First ${free_savings_t:.0f}/mo is free.")

            # R2 storage accumulation
            if total_gb_stored > R2_FREE_STORAGE_GB:
                warnings.append(f"Cloudflare R2 free storage (10 GB) exceeded: {total_gb_stored:.0f} GB stored. Overage: ${(total_gb_stored - R2_FREE_STORAGE_GB) * PRICE_PER_GB_STORAGE:.2f}/mo (negligible).")
        else:
            # --- Full Stack ---
            scale_factor = math.log10(mau + 1) / math.log10(100000)
            if mau <= 100_000:
                costs["database"] = 2550 * scale_factor ** 1.5
                costs["compute_recommendation"] = 3250 * scale_factor ** 1.8
            else:
                growth = mau / 100_000
                costs["database"] = 2550 * growth ** 0.7
                costs["compute_recommendation"] = 3250 * growth ** 0.75

            monitoring_cost = max(200, 2000 * scale_factor)
            auth_cost = max(50, mau * 0.005)
            cdn_plan_cost = 0 if mau < 50_000 else max(5000, 5000 * scale_factor)
            moderation_cost = max(0, videos_per_month * 0.02)
            costs["platform_ops"] = monitoring_cost + auth_cost + cdn_plan_cost + moderation_cost

        costs["total"] = sum(costs.values())

    # --- Revenue Calculation ---
    num_subscribers = mau * (sub_percent / 100.0)
    subscription_revenue_gross = num_subscribers * sub_price
    platform_fees = subscription_revenue_gross * APP_STORE_COMMISSION_RATE
    subscription_revenue_net = subscription_revenue_gross - platform_fees

    non_subscriber_mau = mau * (1 - sub_percent / 100.0)
    avg_mb_per_view = (video_length_sec / 30.0) * 15
    gb_per_video = avg_mb_per_view / 1024
    views_per_user = data_consumption_gb / gb_per_video if gb_per_video > 0 else 0
    total_monthly_views = non_subscriber_mau * views_per_user

    ad_revenue = 0
    ad_eligibility_message = ""
    if total_monthly_views >= AD_IMPRESSION_THRESHOLD:
        monetizable_impressions = total_monthly_views * AD_FILL_RATE * AD_PROGRAMMATIC_FILL
        ad_revenue = (monetizable_impressions / 1000) * ad_rpm
        ad_eligibility_message = "Platform is eligible for AdSense for Video."
    else:
        ad_eligibility_message = f"Platform is NOT eligible. Needs >{AD_IMPRESSION_THRESHOLD:,.0f} monthly views."

    total_revenue = subscription_revenue_net + ad_revenue

    # --- Net Profit ---
    net_profit = total_revenue - costs["total"]

    return {
        "costs": costs,
        "cost_detail": cost_detail,
        "warnings": warnings,
        "subscription_revenue_gross": subscription_revenue_gross,
        "platform_fees": platform_fees,
        "subscription_revenue_net": subscription_revenue_net,
        "ad_revenue": ad_revenue,
        "total_revenue": total_revenue,
        "net_profit": net_profit,
        "ad_eligibility_message": ad_eligibility_message,
        "videos_per_month": (mau * (dau_percent / 100.0) * (upload_percent / 100.0) * 30) if (mau > 0 and user_uploads_enabled) else seeded_videos_per_month,
    }


# --- Architecture Diagram ---
def get_architecture_diagram(lean_mode=False):
    """Returns the Graphviz DOT definition for the architecture diagram."""
    if lean_mode:
        return """
        digraph Architecture {
            rankdir=TB;
            compound=true;
            graph [bgcolor="transparent", fontname="Helvetica", label="Scrollingo — Phase 1 Architecture", fontsize=22, fontcolor="#333", nodesep=0.7, ranksep=1.0, labelloc=t];
            node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11, color="#d0d0d0", fontcolor="#333"];
            edge [fontname="Helvetica", fontsize=9, color="#999"];

            // ── Admin ──
            AdminCLI [label="Admin CLI\\n(seed videos)", shape=cds, fillcolor="#e0e0e0", fontsize=10];

            // ── Mobile Client ──
            subgraph cluster_client {
                label="React Native + Expo (iOS / Android)\\nBase: kirkwat/tiktok";
                style="rounded,filled";
                fillcolor="#e8f0fe";
                color="#4a86c8";
                fontcolor="#1a3a5c";
                fontsize=13;

                AppFeed [label="Video Feed\\n(FlashList + expo-video)\\nTappable Subtitles", fillcolor="#c6dafc"];
                AppWordPopup [label="Word Popup\\ntranslation + definition\\n+ POS + pronunciation", fillcolor="#c6dafc"];
                AppFlashcards [label="Flashcard Review\\n(SM-2 SRS)\\nMMKV offline", fillcolor="#c6dafc"];
                AppTTS [label="On-Device TTS\\n(expo-speech)", fillcolor="#c6dafc"];
                AppDict [label="Offline Dictionary\\n(SQLite)\\nauto-downloaded", fillcolor="#c6dafc"];
                AppSocial [label="Likes / Comments\\nBookmarks / Follows\\nProfiles / Streaks", fillcolor="#c6dafc"];
            }

            // ── Go Backend (fly.io) ──
            subgraph cluster_flyio {
                label="Go Monolith (fly.io · $5/mo)";
                style="rounded,filled";
                fillcolor="#e6f4ea";
                color="#34a853";
                fontcolor="#1e4620";
                fontsize=13;

                API [label="REST API\\n/api/v1/*\\n(chi router)", fillcolor="#a8dab5"];
                FeedSvc [label="Feed Service\\nchronological by language", fillcolor="#a8dab5"];
                WordSvc [label="Word Service\\nvideo_words + definitions", fillcolor="#a8dab5"];
                FlashSvc [label="Flashcard Service\\nSRS + offline sync", fillcolor="#a8dab5"];
                Pipeline [label="AI Pipeline\\n(async goroutines)", fillcolor="#a8dab5"];
                Workers [label="Background Workers\\nview count flush\\nstreak calculation", fillcolor="#a8dab5"];
                GoCache [label="In-Memory Cache\\n(sync.Map)", fillcolor="#a8dab5"];
            }

            // ── Supabase ──
            subgraph cluster_supabase {
                label="Supabase ($25/mo)";
                style="rounded,filled";
                fillcolor="#fef7e0";
                color="#ea8600";
                fontcolor="#5c3d00";
                fontsize=13;

                PostgreSQL [label="PostgreSQL (14 tables)\\nusers · videos · vocab_words\\nword_definitions · video_words\\nflashcards · user_views\\nuser_likes · user_bookmarks\\ncomments · user_follows\\ndaily_progress · pipeline_jobs", shape=cylinder, fillcolor="#fce8b2"];
                SupaAuth [label="Auth\\n(JWT · OAuth\\nGoogle / Apple)", fillcolor="#fce8b2"];
                Realtime [label="Realtime\\n(video ready\\nnotifications)", fillcolor="#fce8b2"];
            }

            // ── Cloudflare ──
            subgraph cluster_cloudflare {
                label="Cloudflare (Free)";
                style="rounded,filled";
                fillcolor="#fce4ec";
                color="#d93025";
                fontcolor="#5c1018";
                fontsize=13;

                R2 [label="R2 Storage\\nvideos/ · tts/ · dictionaries/\\nWebVTT subtitles", shape=folder, fillcolor="#f8bbd0"];
                CDN [label="CDN (Free Egress)\\nprogressive MP4\\nTTS audio · dictionaries", fillcolor="#f8bbd0"];
            }

            // ── AI Providers ──
            subgraph cluster_ai {
                label="AI Providers (Pay-per-use)";
                style="rounded,filled";
                fillcolor="#f3e8fd";
                color="#7c3aed";
                fontcolor="#3b1a6e";
                fontsize=13;

                STT [label="Groq Whisper\\nSTT ($0.0007/min)", fillcolor="#e0cffc"];
                OCR [label="Cloud Vision\\nOCR (burned-in subs)", fillcolor="#e0cffc"];
                Trans [label="Google Translate\\n($20/M chars)", fillcolor="#e0cffc"];
                LLM [label="Gemini Flash\\nContextual Definitions\\n($0.10/M tokens)", fillcolor="#e0cffc"];
            }

            // ── Pre-generated (one-time) ──
            subgraph cluster_pregen {
                label="Pre-generated (one-time)";
                style="rounded,filled";
                fillcolor="#f5f5f5";
                color="#999";
                fontcolor="#555";
                fontsize=11;

                TTSPregen [label="Google Neural2 TTS\\n100K words × 2 langs\\n$22 one-time", fillcolor="#e8e8e8"];
            }

            // ── Monitoring ──
            subgraph cluster_monitoring {
                label="Monitoring (Free Tier)";
                style="rounded,filled";
                fillcolor="#f5f5f5";
                color="#999";
                fontcolor="#555";
                fontsize=11;

                Axiom [label="Axiom (Logs)", fillcolor="#e8e8e8"];
                Sentry [label="Sentry (Errors)", fillcolor="#e8e8e8"];
            }

            // ═══ CONNECTIONS ═══

            // ── Admin uploads video ──
            AdminCLI -> R2 [label="1. Upload MP4", color="#d93025"];
            AdminCLI -> API [label="2. POST /internal/admin/videos\\n(trigger pipeline)", color="#34a853"];

            // ── Client ↔ Backend ──
            AppFeed -> API [label="GET /feed\\nGET /videos/:id/words", color="#4a86c8"];
            AppFeed -> CDN [label="Stream MP4\\n+ load TTS audio", color="#d93025"];
            AppFeed -> AppWordPopup [label="Tap word", color="#4a86c8", style=dotted];
            AppWordPopup -> AppTTS [label="Instant\\npronunciation", color="#4a86c8", style=dotted];
            AppWordPopup -> AppDict [label="Offline\\nlookup", color="#4a86c8", style=dotted];
            AppWordPopup -> AppFlashcards [label="Save word", color="#4a86c8", style=dashed];
            AppFlashcards -> API [label="Sync SRS state\\n(offline → server)", color="#4a86c8", style=dashed];
            AppSocial -> API [label="Likes · Comments\\nBookmarks · Follows\\nProgress sync", color="#4a86c8"];
            AppDict -> CDN [label="Download dictionaries\\non language change", color="#d93025", style=dashed];

            // ── Auth ──
            AppFeed -> SupaAuth [label="Login / Signup\\n(JWT + OAuth)", color="#ea8600", style=dotted];
            API -> SupaAuth [label="Verify JWT", color="#ea8600", style=dotted];

            // ── Backend ↔ Data ──
            API -> FeedSvc [color="#34a853", style=dotted];
            API -> WordSvc [color="#34a853", style=dotted];
            API -> FlashSvc [color="#34a853", style=dotted];
            FeedSvc -> PostgreSQL [label="Feed query", color="#ea8600"];
            FeedSvc -> GoCache [color="#34a853", style=dotted];
            WordSvc -> PostgreSQL [label="video_words\\n+ word_definitions\\n+ vocab_words", color="#ea8600"];
            FlashSvc -> PostgreSQL [label="Flashcards\\n+ SRS sync", color="#ea8600"];
            Workers -> PostgreSQL [label="Flush view counts\\nstreak calc", color="#ea8600", style=dotted];

            // ── Realtime ──
            PostgreSQL -> Realtime [label="status=ready", color="#ea8600", style=dashed];
            Realtime -> AppFeed [label="New video\\nnotification", color="#ea8600", style=dashed];

            // ── Storage ──
            R2 -> CDN [label="Origin", color="#d93025"];
            API -> R2 [label="Presigned URLs\\nfor CDN paths", color="#d93025", style=dotted];

            // ── AI Pipeline (async, per video) ──
            Pipeline -> STT [label="Audio → transcript\\n(word timestamps)", color="#7c3aed", style=dashed];
            Pipeline -> OCR [label="Frames → text\\n(burned-in subs)", color="#7c3aed", style=dashed];
            Pipeline -> Trans [label="Translate transcript\\n× 12 native langs", color="#7c3aed", style=dashed];
            Pipeline -> LLM [label="Contextual definitions\\n× every word × 12 langs", color="#7c3aed", style=dashed];
            Pipeline -> PostgreSQL [label="Store vocab_words\\nword_definitions\\nvideo_words\\npipeline status", color="#ea8600", style=dashed];
            Pipeline -> R2 [label="Store WebVTT\\nsubtitle files", color="#d93025", style=dashed];

            // ── Pre-generated TTS ──
            TTSPregen -> R2 [label="100K words\\n× 2 learning langs\\nstored in tts/", color="#999", style=dashed];

            // ── Monitoring ──
            API -> Axiom [style=dotted, color="#999"];
            API -> Sentry [style=dotted, color="#999"];
            Pipeline -> Sentry [style=dotted, color="#999"];
        }
        """
    else:
        return """
        digraph Architecture {
            rankdir=TB;
            graph [bgcolor="transparent", fontname="sans-serif", label="Full Stack Architecture", fontsize=24, fontcolor="#333", nodesep=0.5, ranksep=1];
            node [shape=box, style="rounded,filled", fillcolor="#ffffff", fontname="sans-serif", color="#333", fontsize=14];
            edge [fontname="sans-serif", fontsize=12, color="#333"];

            subgraph cluster_user {
                label = "";
                style=invis;
                RNApp [label="React Native + Expo\\n(iOS/Android)", shape=mobile, style="filled", fillcolor="#4a90e2", fontcolor="white", fontsize=14];
            }

            subgraph cluster_backend {
                label="Backend Microservices (Go & Python)";
                style="rounded";
                bgcolor="#e6f2ff";

                APIGateway [label="API Gateway (Go)"];
                UserService [label="User Service (Go)"];
                VideoService [label="Video Service (Go)"];
                LanguageService [label="Language Proc. (Python)"];
                FeedService [label="Feed Service (Go)"];
                FlashcardService [label="Flashcard Service (Go)"];
                DictionaryService [label="Dictionary Service (Go)"];
                RealtimeService [label="Real-time (Go)"];
            }

            subgraph cluster_data {
                label="Data Stores";
                style="rounded";
                bgcolor="#d9ead3";
                node [shape=cylinder, fillcolor="#f3f3f3"];

                PostgreSQL [label="PostgreSQL (Relational)"];
                ScyllaDB [label="ScyllaDB (NoSQL)"];
                Redis [label="Redis Cache"];
                Neptune [label="Graph DB (Neptune)"];
            }

            subgraph cluster_media_ai {
                label="Media & AI Pipeline";
                style="rounded";
                bgcolor="#fff2cc";

                CloudflareR2 [label="Cloudflare R2 (Storage)"];
                CloudflareCDN [label="Cloudflare CDN (Delivery)"];
                MediaConvert [label="AWS MediaConvert"];
                STT [label="STT Provider"];
                TTS [label="TTS Provider"];
                GoogleTranslate [label="Google Translate API"];
            }

            subgraph cluster_recommendation {
                label="Recommendation & Event Bus";
                style="rounded";
                bgcolor="#f4cccc";

                KinesisBus [label="Amazon Kinesis (Event Bus)"];
                Pinecone [label="Pinecone (Vector DB)"];
                SageMaker [label="Amazon SageMaker (ML)"];
            }

            RNApp -> APIGateway [label="REST API Calls"];
            RNApp -> CloudflareCDN [label="Loads Media"];
            CloudflareCDN -> CloudflareR2 [label="Caches From"];

            APIGateway -> UserService;
            APIGateway -> VideoService;
            APIGateway -> FeedService;
            APIGateway -> FlashcardService;
            APIGateway -> DictionaryService;

            RNApp -> RealtimeService [label="WebSocket", style=dashed, color="#3c78d8"];

            UserService -> PostgreSQL;
            UserService -> Neptune;
            VideoService -> ScyllaDB;
            FlashcardService -> PostgreSQL;
            DictionaryService -> PostgreSQL;
            DictionaryService -> Redis;
            FeedService -> Redis;

            VideoService -> KinesisBus [label="video.uploaded", style=dashed, color="#e06666", fontcolor="#e06666"];
            KinesisBus -> LanguageService [style=dashed, color="#e06666"];
            LanguageService -> STT [label="Speech-to-Text"];
            LanguageService -> TTS [label="Text-to-Speech"];
            LanguageService -> GoogleTranslate [label="Translation"];
            LanguageService -> VideoService [label="Updates Metadata"];

            VideoService -> KinesisBus [label="notification.created", style=dashed, color="#3d85c6", fontcolor="#3d85c6"];
            KinesisBus -> RealtimeService [style=dashed, color="#3d85c6"];

            FeedService -> Pinecone [label="Gets Recs"];
            RNApp -> KinesisBus [label="User Events", style=dashed, color="#6aa84f", fontcolor="#6aa84f"];
            KinesisBus -> SageMaker [label="Training Data", style=dashed, color="#6aa84f"];
        }
        """


# --- Streamlit App UI ---
st.set_page_config(layout="wide", page_title="Scrollingo - Profitability Estimator")

st.title("Scrollingo - Profitability Estimator")
st.markdown("Adjust the sliders on the left to model costs and revenue for the language learning platform.")

with st.sidebar:
    st.header("Infrastructure Mode")
    lean_mode_toggle = st.toggle("Lean Startup Mode", value=False,
                          help="Minimal infrastructure: Supabase, fly.io, free monitoring, Cloudflare free CDN. Max 100K MAU.")
    user_uploads_enabled = st.toggle("User Uploads Enabled", value=True,
                                     help="Disable to model curated-only content (team seeds videos, no UGC).")

    seeded_videos_per_month = 100
    if not user_uploads_enabled:
        seeded_videos_per_month = st.slider("Team-Seeded Videos per Month", 10, 500, 100, 10)

    st.header("AI Provider Selection")
    with st.expander("Speech-to-Text (STT)", expanded=False):
        stt_provider = st.selectbox(
            "STT Provider",
            options=list(STT_PRICING.keys()),
            index=1 if lean_mode_toggle else 0,
            help="Groq Whisper Turbo is 9x cheaper than OpenAI Whisper with comparable quality."
        )
        st.caption(f"Rate: ${STT_PRICING[stt_provider]:.4f}/min")

    with st.expander("Text-to-Speech (TTS)", expanded=False):
        tts_provider = st.selectbox(
            "TTS Provider",
            options=list(TTS_PRICING.keys()),
            index=1 if lean_mode_toggle else 0,
            help="Google Neural2 is 10x cheaper than ElevenLabs. On-Device is free but lower quality."
        )
        st.caption(f"Rate: ${TTS_PRICING[tts_provider]:.3f}/1K chars")

        tts_caching_enabled = st.toggle(
            "TTS Word Caching",
            value=lean_mode_toggle,
            help="Cache top 10K words (Zipf's law). Covers 95-97% of requests, reducing TTS API calls by ~67%."
        )

        on_device_realtime = st.toggle(
            "On-Device TTS/STT for Practice",
            value=True,
            help="Use Expo Speech / react-native-tts for interactive pronunciation practice (free, no API cost)."
        )

    with st.expander("Translation", expanded=False):
        translation_provider = st.selectbox(
            "Translation Provider",
            options=list(TRANSLATION_PRICING.keys()),
            index=0,
            help="Self-hosted NLLB is free but requires GPU compute (factored into compute costs)."
        )
        st.caption(f"Rate: ${TRANSLATION_PRICING[translation_provider]:.0f}/M chars")

    with st.expander("Contextual Definitions (LLM)", expanded=False):
        llm_provider = st.selectbox(
            "LLM Provider",
            options=list(LLM_PRICING.keys()),
            index=0,
            help="Generates contextual translation, definition, and part of speech for each word in every video."
        )
        inp, out = LLM_PRICING[llm_provider]
        st.caption(f"Rate: ${inp:.2f} input / ${out:.2f} output per 1M tokens")

        num_target_languages = st.slider("Native Languages (definition targets)", 1, 20, 12, 1,
            help="Number of native languages to generate contextual definitions for. Phase 1: 12 native languages (en, es, zh, ja, ko, hi, fr, de, pt, ar, it, ru).")

    st.header("Transcoding Strategy")
    transcode_strategy = st.selectbox(
        "Video Transcoding",
        options=list(TRANSCODE_STRATEGIES.keys()),
        index=1 if lean_mode_toggle else 0,
        help="Client-side compression + progressive MP4 eliminates server transcoding costs entirely."
    )
    st.caption(TRANSCODE_STRATEGIES[transcode_strategy]["description"])

    st.header("Core Assumptions")
    with st.expander("User Base & Activity", expanded=True):
        all_log_options = [
            100, 250, 500, 1000, 2500, 5000, 7500, 10000, 25000, 50000, 75000,
            100000, 250000, 500000, 750000, 1000000, 2500000, 5000000, 7500000,
            10000000, 15000000, 20000000
        ]
        # Limit MAU options in lean mode
        if lean_mode_toggle:
            log_options = [x for x in all_log_options if x <= LEAN_MODE_MAX_MAU]
        else:
            log_options = all_log_options
        default_mau = 1000 if lean_mode_toggle else 1000000
        mau = st.select_slider("Monthly Active Users (MAU)", options=log_options,
                                value=default_mau if default_mau in log_options else log_options[-1])
        # Enforce lean mode cap
        lean_mode = lean_mode_toggle and mau <= LEAN_MODE_MAX_MAU
        if lean_mode_toggle and mau > LEAN_MODE_MAX_MAU:
            lean_mode = False
        dau_percent = st.slider("Daily Active Users (% of MAU)", 5, 50, 20, 1)
        data_consumption_gb = st.slider("Monthly Data Consumption per User (GB)", 0.1, 20.0, 2.0, 0.1)

    with st.expander("Content & Uploads", expanded=True):
        upload_percent = st.slider("Content Uploads (% of DAU per day)", 0, 20, 5, 1,
                                   disabled=not user_uploads_enabled)
        video_length_sec = st.slider("Average Video Length (seconds)", 5, 120, 30, 5)
        total_platform_videos = st.number_input(
            "Total Videos on Platform",
            min_value=0, max_value=10_000_000, value=0, step=100,
            help="Total number of videos stored on the platform. Set to 0 to auto-calculate from monthly uploads x 12."
        )

    st.header("Monetization Levers")
    with st.expander("Subscription Model", expanded=True):
        sub_price = st.slider("Monthly Subscription Price ($)", 0.0, 30.0, 7.99, 0.50)
        sub_percent = st.slider("% of MAUs that Subscribe", 0.25, 40.0, 2.0, 0.25, format="%.2f%%")

    with st.expander("Advertising Model", expanded=True):
        ad_rpm = st.slider("Ad RPM (per 1,000 views)", 0.04, 0.50, 0.10, 0.01, format="$%.2f")

financials = calculate_financials(
    mau, dau_percent, upload_percent, video_length_sec,
    sub_price, sub_percent, ad_rpm, data_consumption_gb,
    lean_mode=lean_mode,
    user_uploads_enabled=user_uploads_enabled,
    seeded_videos_per_month=seeded_videos_per_month,
    stt_provider=stt_provider,
    tts_provider=tts_provider,
    translation_provider=translation_provider,
    transcode_strategy=transcode_strategy,
    tts_caching_enabled=tts_caching_enabled,
    on_device_realtime=on_device_realtime,
    total_platform_videos=total_platform_videos,
    llm_provider=llm_provider,
    num_target_languages=num_target_languages,
)

# --- Tabbed Interface ---
tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs(["Financial Dashboard", "System Architecture", "Cost Optimizer", "Phase 1 Requirements", "Database Design", "Implementation Guide", "OCR Research"])

with tab1:
    # Mode indicators
    if lean_mode:
        st.info(f"LEAN STARTUP MODE (max {LEAN_MODE_MAX_MAU:,} MAU): Supabase DB + Auth, fly.io hosting, free monitoring (Axiom + Sentry), Cloudflare free CDN.")
    if not user_uploads_enabled:
        st.info(f"CURATED CONTENT MODE: No user uploads. Team seeds {seeded_videos_per_month} videos/month.")

    # Free tier / capacity warnings
    if financials.get("warnings"):
        for w in financials["warnings"]:
            st.warning(w)

    provider_summary = f"STT: {stt_provider} | TTS: {tts_provider} | Definitions: {llm_provider} | Transcode: {transcode_strategy}"
    provider_summary += f" | {num_target_languages} languages"
    st.caption(provider_summary)

    st.header("Financial Summary")
    profit_color = "normal"
    if financials['net_profit'] > 0: profit_color = "inverse"
    elif financials['net_profit'] < 0: profit_color = "off"
    st.metric(label="Net Monthly Profit (Revenue - Costs)", value=f"${financials['net_profit']:,.0f}", delta_color=profit_color)
    st.markdown("---")

    col1, col2 = st.columns(2)
    with col1:
        st.subheader("Revenue Breakdown")
        st.metric(label="Total Monthly Revenue (Net)", value=f"${financials['total_revenue']:,.0f}")
        st.metric(label="Subscription Revenue (Gross)", value=f"${financials['subscription_revenue_gross']:,.0f}")
        st.metric(label="App Store Commission (15%)", value=f"-${financials['platform_fees']:,.0f}")
        st.metric(label="Subscription Revenue (Net)", value=f"${financials['subscription_revenue_net']:,.0f}")
        st.metric(label="Ad Revenue", value=f"${financials['ad_revenue']:,.0f}")
        st.info(financials['ad_eligibility_message'])
    with col2:
        st.subheader("Cost Breakdown")
        st.metric(label="Total Monthly Costs", value=f"${financials['costs']['total']:,.0f}")
        st.metric(label="Media Processing & AI", value=f"${financials['costs']['media_processing']:,.0f}")

        # Detailed AI cost breakdown
        if financials.get("cost_detail"):
            detail = financials["cost_detail"]
            cols = st.columns(5)
            cols[0].caption(f"Transcode: ${detail.get('transcode', 0):,.2f}")
            cols[1].caption(f"STT: ${detail.get('stt', 0):,.2f}")
            cols[2].caption(f"TTS: ${detail.get('tts', 0):,.2f}")
            cols[3].caption(f"Translate: ${detail.get('translate', 0):,.2f}")
            cols[4].caption(f"Definitions: ${detail.get('definitions', 0):,.2f}")

        st.metric(label="Storage & Delivery", value=f"${financials['costs']['storage_delivery']:,.0f}")
        st.metric(label="Database & Compute", value=f"${financials['costs']['database'] + financials['costs']['compute_recommendation']:,.0f}")
        st.metric(label="Platform Ops (CDN, Auth, Monitoring, Moderation)", value=f"${financials['costs']['platform_ops']:,.0f}")

    st.markdown("---")

    # Breakeven analysis
    with st.expander("Breakeven Analysis"):
        rev_per_user = sub_price * (sub_percent / 100.0) * (1 - APP_STORE_COMMISSION_RATE)
        if rev_per_user > 0 and financials['costs']['total'] > 0:
            breakeven_mau = math.ceil(financials['costs']['total'] / rev_per_user)
            st.metric(label="Breakeven MAU (subscription only)", value=f"{breakeven_mau:,}")
            st.caption(f"At ${sub_price}/mo with {sub_percent}% conversion and 15% App Store cut, "
                       f"each MAU generates ${rev_per_user:.4f}/mo in net subscription revenue.")
        else:
            st.warning("Set subscription price and conversion rate to calculate breakeven.")

        st.markdown(f"**Videos processed this month:** {financials['videos_per_month']:,.0f}")
        mode_label = "Lean" if lean_mode else "Full Stack"
        uploads_label = "Curated Only" if not user_uploads_enabled else "User Uploads"
        st.markdown(f"**Mode:** {mode_label} | **Content:** {uploads_label}")

    with st.expander("View Pricing Information & Sources"):
        st.markdown(f"""
        ### AI Provider Pricing (Selected)
        - **STT ({stt_provider}):** `${STT_PRICING[stt_provider]:.4f}` per audio minute
        - **TTS ({tts_provider}):** `${TTS_PRICING[tts_provider]:.3f}` per 1,000 characters
        - **Translation ({translation_provider}):** `${TRANSLATION_PRICING[translation_provider]:.0f}` per million characters
        - **TTS Caching:** {"Enabled (67% reduction via Zipf's law word caching)" if tts_caching_enabled else "Disabled"}

        ### STT Provider Comparison
        | Provider | $/minute | vs. Whisper |
        |----------|----------|-------------|
        | OpenAI Whisper | $0.0060 | baseline |
        | Google Speech-to-Text | $0.0040 | 33% cheaper |
        | Deepgram Nova-2 | $0.0043 | 28% cheaper |
        | **Groq Whisper Turbo** | **$0.000667** | **89% cheaper** |

        ### TTS Provider Comparison
        | Provider | $/1K chars | vs. ElevenLabs |
        |----------|-----------|----------------|
        | ElevenLabs (Scale) | $0.165 | baseline |
        | Google Neural2 | $0.016 | 90% cheaper |
        | Amazon Polly Neural | $0.016 | 90% cheaper |
        | Azure Neural TTS | $0.016 | 90% cheaper |
        | On-Device (Expo) | $0.000 | 100% cheaper |

        ### Transcoding Strategy
        - **{transcode_strategy}:** {TRANSCODE_STRATEGIES[transcode_strategy]["description"]}

        ### Storage & Delivery (Cloudflare R2)
        - **Storage:** `${PRICE_PER_GB_STORAGE}` per GB-month.
        - **Class A Operations (Writes):** `${PRICE_PER_MILLION_WRITE_OPS:,.2f}` per million requests.
        - **Class B Operations (Reads):** `${PRICE_PER_MILLION_READ_OPS:,.2f}` per million requests.
        - **Egress:** $0 (Free). CDN cache hit rate: {CDN_CACHE_HIT_RATE*100:.0f}%.

        ### Advertising
        - **AdSense for Video RPM:** $0.04 - $0.50 (education niche).
        - **Fill Rate:** {AD_FILL_RATE*100:.0f}% of views show ads, {AD_PROGRAMMATIC_FILL*100:.0f}% programmatic fill.
        - **Eligibility:** >{AD_IMPRESSION_THRESHOLD:,.0f} monthly views required.
        - Premium subscribers excluded from ad impressions.

        ### App Store Commission
        - {APP_STORE_COMMISSION_RATE*100:.0f}% (Small Business Program, year 2+). Year 1 is 30%.

        ### Lean Mode Infrastructure
        - **Database:** Supabase Pro ($25/mo) includes PostgreSQL + Auth for 100K MAU
        - **Hosting:** fly.io ($10-50/mo) or Cloudflare Workers. Go monolith.
        - **Monitoring:** Axiom (500GB/mo free) + Sentry (free tier) + Grafana Cloud (free) = $0
        - **Auth:** Supabase Auth (included, free for 100K MAU)
        - **CDN:** Cloudflare Free plan (R2 egress is free, Pro $20/mo at scale)
        - **Cache:** Go in-memory (sync.Map) - no Redis needed below 50K MAU

        ### Mobile App Stack
        - **Framework:** React Native + Expo (TypeScript)
        - **Base Repo:** kirkwat/tiktok (auth, video feed, likes, comments, profiles, DMs)
        - **State:** Zustand (migrated from Redux Toolkit)
        - **Video:** expo-video with FlashList (@shopify/flash-list)
        - **On-Device TTS/STT:** expo-speech (free, no API cost)
        - **Offline:** react-native-mmkv for flashcards, SQLite for dictionary cache
        """)

with tab2:
    arch_view = st.radio("View", ["Phase 1 (Lean)", "Full Stack (Phase 3)"], horizontal=True)
    st.graphviz_chart(get_architecture_diagram(lean_mode=(arch_view == "Phase 1 (Lean)")), use_container_width=True)

with tab3:
    st.header("Cost Optimizer")
    st.markdown("Compare your current configuration against optimized alternatives.")

    # Calculate costs for different presets
    def calc_preset(preset_name, **overrides):
        defaults = dict(
            mau=mau, dau_percent=dau_percent, upload_percent=upload_percent,
            video_length_sec=video_length_sec, sub_price=sub_price, sub_percent=sub_percent,
            ad_rpm=ad_rpm, data_consumption_gb=data_consumption_gb,
            lean_mode=lean_mode, user_uploads_enabled=user_uploads_enabled,
            seeded_videos_per_month=seeded_videos_per_month,
            stt_provider=stt_provider, tts_provider=tts_provider,
            translation_provider=translation_provider,
            transcode_strategy=transcode_strategy,
            tts_caching_enabled=tts_caching_enabled,
            on_device_realtime=on_device_realtime,
            total_platform_videos=total_platform_videos,
            llm_provider=llm_provider,
            num_target_languages=num_target_languages,
        )
        defaults.update(overrides)
        return calculate_financials(**defaults)

    # Current config
    current = financials

    # Budget config
    budget = calc_preset("Budget",
        lean_mode=True,
        stt_provider="Groq Whisper (Turbo)",
        tts_provider="Google Cloud Neural2",
        transcode_strategy="Client Compress + Progressive MP4",
        tts_caching_enabled=True,
        user_uploads_enabled=False,
        seeded_videos_per_month=seeded_videos_per_month,
    )

    # Balanced config
    balanced = calc_preset("Balanced",
        lean_mode=True,
        stt_provider="Groq Whisper (Turbo)",
        tts_provider="Google Cloud Neural2",
        transcode_strategy="Delayed Transcoding (>100 views)",
        tts_caching_enabled=True,
    )

    # Premium (current full stack but with optimized AI)
    premium = calc_preset("Premium",
        lean_mode=False,
        stt_provider="Groq Whisper (Turbo)",
        tts_provider="ElevenLabs (Scale)",
        transcode_strategy="Mux (Managed)",
        tts_caching_enabled=True,
    )

    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.markdown("**Your Config**")
        st.metric("Total Cost", f"${current['costs']['total']:,.0f}")
        st.metric("Net Profit", f"${current['net_profit']:,.0f}")
    with col2:
        st.markdown("**Budget**")
        st.caption("Lean + Groq STT + Google TTS + Client Compress + Caching + No UGC")
        st.metric("Total Cost", f"${budget['costs']['total']:,.0f}",
                  delta=f"{((budget['costs']['total'] - current['costs']['total']) / max(current['costs']['total'], 1)) * 100:+.0f}%")
        st.metric("Net Profit", f"${budget['net_profit']:,.0f}")
    with col3:
        st.markdown("**Balanced**")
        st.caption("Lean + Groq STT + Google TTS + Delayed Transcode + Caching")
        st.metric("Total Cost", f"${balanced['costs']['total']:,.0f}",
                  delta=f"{((balanced['costs']['total'] - current['costs']['total']) / max(current['costs']['total'], 1)) * 100:+.0f}%")
        st.metric("Net Profit", f"${balanced['net_profit']:,.0f}")
    with col4:
        st.markdown("**Premium**")
        st.caption("Full Stack + Groq STT + ElevenLabs TTS + Mux + Caching")
        st.metric("Total Cost", f"${premium['costs']['total']:,.0f}",
                  delta=f"{((premium['costs']['total'] - current['costs']['total']) / max(current['costs']['total'], 1)) * 100:+.0f}%")
        st.metric("Net Profit", f"${premium['net_profit']:,.0f}")

    st.markdown("---")

    # Savings breakdown table
    st.subheader("Savings Breakdown by Category")
    st.markdown(f"""
    | Category | Your Config | Budget | Balanced | Premium |
    |----------|-----------|--------|----------|---------|
    | Media Processing | ${current['costs']['media_processing']:,.0f} | ${budget['costs']['media_processing']:,.0f} | ${balanced['costs']['media_processing']:,.0f} | ${premium['costs']['media_processing']:,.0f} |
    | Storage & Delivery | ${current['costs']['storage_delivery']:,.0f} | ${budget['costs']['storage_delivery']:,.0f} | ${balanced['costs']['storage_delivery']:,.0f} | ${premium['costs']['storage_delivery']:,.0f} |
    | Database | ${current['costs']['database']:,.0f} | ${budget['costs']['database']:,.0f} | ${balanced['costs']['database']:,.0f} | ${premium['costs']['database']:,.0f} |
    | Compute | ${current['costs']['compute_recommendation']:,.0f} | ${budget['costs']['compute_recommendation']:,.0f} | ${balanced['costs']['compute_recommendation']:,.0f} | ${premium['costs']['compute_recommendation']:,.0f} |
    | Platform Ops | ${current['costs']['platform_ops']:,.0f} | ${budget['costs']['platform_ops']:,.0f} | ${balanced['costs']['platform_ops']:,.0f} | ${premium['costs']['platform_ops']:,.0f} |
    | **Total** | **${current['costs']['total']:,.0f}** | **${budget['costs']['total']:,.0f}** | **${balanced['costs']['total']:,.0f}** | **${premium['costs']['total']:,.0f}** |
    """)

    st.subheader("Recommended Phased Approach")
    st.markdown("""
    **Phase 1 (0-10K MAU):** Video Distribution + Social + Language Learning UI
    - Chronological feed, likes, comments, bookmarks, user profiles
    - Subtitle overlays, tap-to-translate, vocab saving, flashcards (SRS)
    - Curated content only (no user uploads), on-device TTS/STT
    - Expected cost: **$30-85/mo**

    **Phase 1.5:** Content Recommendation
    - Feed scoring (Krashen's i+1 difficulty matching)
    - Personalized feed, quiz cards interleaved in feed
    - Watch history weighting, engagement analytics
    - Expected cost: same infrastructure, no additional cost

    **Phase 2 (10K-100K MAU):** Scale
    - Enable user uploads with delayed transcoding
    - Redis, multi-instance HA, push notifications
    - Expected cost: **$100-600/mo**

    **Phase 3 (100K+ MAU):** Growth
    - ML recommendation engine, A/B testing, content moderation
    - Mux for managed transcoding, HLS streaming
    - Expected cost: **$2,000-15,000/mo**
    """)

with tab4:
    st.header("Phase 1 Requirements")
    st.markdown("Video Distribution + Social + Language Learning UI")
    st.markdown("---")

    st.subheader("Video Feed")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R1 | Full-screen vertical scroll video feed (TikTok-style) |
| R2 | Videos play automatically on scroll, pause when off-screen |
| R3 | Feed is chronological, filtered by user's active learning language |
| R4 | No user uploads — team seeds ~100 curated videos/month via admin CLI |
| R5 | Videos are 720p progressive MP4 served from Cloudflare R2 CDN |
    """)

    st.subheader("Social")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R6 | Like, comment, and bookmark videos (persisted to server) |
| R7 | User profiles with avatar, stats (followers, following, streak) |
| R8 | Auth via Supabase (email/password + Google/Apple OAuth) |
| R9 | Direct messages (inherited from kirkwat/tiktok base repo) |
    """)

    st.subheader("Subtitles & Word Interaction")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R10 | Tappable subtitle overlay synced to video playback — every word is individually tappable |
| R11 | Tap any word → bottom sheet with translation, contextual definition, part of speech, pronunciation |
| R12 | Lookup direction: video language → user's native language (always) |
| R13 | Two subtitle sources: (a) STT-generated from audio, (b) OCR-extracted from burned-in subtitles |
| R14 | OCR subtitle extraction for content sourced from other platforms with hardcoded subtitles |
| R15 | Pipeline auto-detects subtitle source: burned-in text → OCR, otherwise → STT from audio |
| R16 | Both subtitle sources produce the same normalized word-timestamp format for the overlay |
    """)

    st.subheader("Flashcards & Vocab")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R17 | Save any word as a flashcard (from word tap or subtitle context) |
| R18 | Flashcard review with SM-2 spaced repetition algorithm |
| R19 | Flashcards work offline (MMKV persistence, sync on reconnect) |
| R20 | On-device TTS for instant word pronunciation (expo-speech, free) |
| R21 | High-quality pre-generated TTS audio from R2 for flashcard review |
    """)

    st.subheader("Language System")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R22 | User sets one native language + one or more learning languages |
| R23 | Learning languages (Phase 1): **English, Chinese** |
| R24 | Native languages (12): en, es, zh, ja, ko, hi, fr, de, pt, ar, it, ru |
| R25 | English and Chinese can be both learning AND native |
| R26 | Offline bilingual dictionaries (SQLite, ~20 pairs), auto-downloaded on language change |
| R27 | Chinese dictionaries handle simplified/traditional characters + pinyin |
| R28 | LLM contextual definitions for every word in every video, per native language |
| R29 | Dictionary adapter factory with fallback to remote API for missing offline pairs |
    """)

    st.subheader("Progress")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R30 | Daily streak tracking with streak badges |
| R31 | Stats dashboard: words learned, videos watched, cards reviewed |
| R32 | Daily activity sync to server |
    """)

    st.subheader("Content Pipeline (Backend)")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R33 | Admin CLI uploads video → triggers AI pipeline |
| R34 | Pipeline: detect subtitle source (OCR or STT) → Translation → Definitions (LLM) → store in R2 |
| R35 | OCR via cloud vision API for burned-in subs; STT via Groq Whisper for audio-only |
| R36 | Pre-generated TTS for all ~100K words per learning language, stored in R2 |
| R37 | Videos marked "ready" after pipeline completes; Supabase Realtime notifies clients |
    """)

    st.markdown("---")
    st.subheader("Phase 1.5 (Deferred)")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R38 | Feed scoring algorithm (Krashen's i+1 difficulty matching) |
| R39 | Personalized feed using recency, popularity, difficulty match, novelty |
| R40 | Mid-scroll quiz cards interleaved in feed |
| R41 | Quiz generation from user's learned vocabulary |
    """)

    st.markdown("---")
    st.subheader("Non-Functional Requirements")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| N1 | Monthly infrastructure cost ≤ $85 at 10K MAU |
| N2 | App binary < 50 MB (dictionaries downloaded on-demand) |
| N3 | Video start-to-play < 2 seconds on 4G |
| N4 | Flashcard review works fully offline |
| N5 | Dictionary lookup < 100ms (local SQLite) |
    """)

with tab5:
    st.header("Database Design")
    st.markdown("Supabase PostgreSQL | 12 tables | Phase 1")
    st.markdown("---")

    st.subheader("Entity Relationships")
    st.code("""
users ─────────────┬──────────────┬───────────────┬──────────────┐
                   │              │               │              │
              user_views     user_likes     user_bookmarks   comments
                   │              │               │              │
                   └──────┬───────┘               │              │
                          │                       │              │
                       videos ────────────── video_words ────────┘
                          │                    │
                     pipeline_jobs        vocab_words ──── word_definitions
                                               │
                                          flashcards
                                               │
                                        daily_progress
    """, language=None)

    st.subheader("Table Summary")
    st.markdown("""
| Table | Purpose | Req |
|-------|---------|-----|
| `users` | Profile, language prefs, streak, stats | R7, R8, R18-R21, R26 |
| `videos` | Video metadata, status, counts | R1-R5, R29, R32 |
| `vocab_words` | Canonical word entries per language (word, frequency, TTS URL, pinyin) | R11, R22, R31 |
| `word_definitions` | LLM contextual definitions per (word, target_lang, sentence_context) | R11, R24, R30 |
| `video_words` | Links words in a video to their timestamps + definitions | R10, R11 |
| `flashcards` | User's saved words with SM-2 SRS state | R13-R15, R17 |
| `user_views` | Watch tracking (completion %, view count) | R2, R3, R27 |
| `user_likes` | Liked videos | R6 |
| `user_bookmarks` | Bookmarked videos | R6 |
| `comments` | Video comments | R6 |
| `daily_progress` | Daily streak + activity stats | R26-R28 |
| `pipeline_jobs` | AI pipeline tracking per video | R29, R30, R32 |
    """)

    st.markdown("---")
    st.subheader("Schema DDL")

    with st.expander("1. users", expanded=False):
        st.code("""CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supabase_uid        TEXT UNIQUE NOT NULL,
    username            TEXT UNIQUE,
    display_name        TEXT,
    avatar_url          TEXT,
    native_language     TEXT NOT NULL DEFAULT 'en',
    target_language     TEXT NOT NULL DEFAULT 'en',
    learning_languages  TEXT[] NOT NULL DEFAULT '{"en"}',
    daily_goal_minutes  SMALLINT NOT NULL DEFAULT 10,
    streak_days         INT NOT NULL DEFAULT 0,
    streak_last_date    DATE,
    total_words_learned INT NOT NULL DEFAULT 0,
    total_videos_watched INT NOT NULL DEFAULT 0,
    premium             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);""", language="sql")

    with st.expander("2. videos", expanded=False):
        st.code("""CREATE TABLE videos (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title             TEXT NOT NULL,
    description       TEXT,
    language          TEXT NOT NULL,
    difficulty        TEXT,              -- Free-form (Phase 2: CEFR/HSK)
    duration_sec      SMALLINT NOT NULL,
    tags              TEXT[] DEFAULT '{}',
    r2_video_key      TEXT NOT NULL,
    cdn_url           TEXT NOT NULL,
    thumbnail_url     TEXT,
    transcript_text   TEXT,
    status            TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('uploading','processing','ready','failed')),
    seeded_by         TEXT,
    processed_at      TIMESTAMPTZ,
    view_count        INT NOT NULL DEFAULT 0,
    like_count        INT NOT NULL DEFAULT 0,
    comment_count     INT NOT NULL DEFAULT 0,
    bookmark_count    INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);""", language="sql")

    with st.expander("3. vocab_words", expanded=False):
        st.markdown("Canonical word entries. One row per unique word per language. TTS pre-generated. POS lives in `word_definitions` (context-dependent).")
        st.code("""CREATE TABLE vocab_words (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    word            TEXT NOT NULL,
    language        TEXT NOT NULL,
    frequency_rank  INT,
    pinyin          TEXT,           -- Chinese only
    simplified      TEXT,           -- Chinese only
    traditional     TEXT,           -- Chinese only
    tts_url         TEXT,           -- R2 CDN URL
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(word, language)
);""", language="sql")

    with st.expander("4. word_definitions", expanded=False):
        st.markdown("LLM-generated contextual definitions. Same word can have different meanings per sentence context.")
        st.code("""CREATE TABLE word_definitions (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vocab_word_id          UUID NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
    target_language        TEXT NOT NULL,
    sentence_context       TEXT,
    translation            TEXT NOT NULL,           -- Just the word, not the sentence
    contextual_definition  TEXT NOT NULL,           -- LLM explanation in target language
    part_of_speech         TEXT,
    llm_provider           TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(vocab_word_id, target_language, sentence_context)
);""", language="sql")
        st.markdown("**Example**: 'bank' in 'river bank' → orilla (es) vs 'bank' in 'go to the bank' → banco (es)")

    with st.expander("5. video_words", expanded=False):
        st.markdown("Links words to their timestamps in a video. Replaces old `subtitles.word_data` JSONB.")
        st.code("""CREATE TABLE video_words (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id        UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    vocab_word_id   UUID NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
    definition_id   UUID REFERENCES word_definitions(id),
    start_ms        INT NOT NULL,
    end_ms          INT NOT NULL,
    word_index      SMALLINT NOT NULL,
    display_text    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);""", language="sql")

    with st.expander("6. flashcards", expanded=False):
        st.markdown("User's saved words with SM-2 SRS. References `vocab_words` and `word_definitions` by FK — no data duplication. Client MMKV caches display data for offline.")
        st.code("""CREATE TABLE flashcards (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vocab_word_id    UUID NOT NULL REFERENCES vocab_words(id),
    definition_id    UUID REFERENCES word_definitions(id),
    source_video_id  UUID REFERENCES videos(id),
    ease_factor      REAL NOT NULL DEFAULT 2.5,
    interval_days    INT NOT NULL DEFAULT 0,
    repetitions      INT NOT NULL DEFAULT 0,
    next_review      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_review      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);""", language="sql")

    with st.expander("7-10. Interactions (views, likes, bookmarks, comments)", expanded=False):
        st.code("""CREATE TABLE user_views (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    watch_percent SMALLINT NOT NULL DEFAULT 0,
    view_count SMALLINT NOT NULL DEFAULT 1,
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE TABLE user_likes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE TABLE user_bookmarks (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (length(body) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);""", language="sql")

    with st.expander("11. daily_progress", expanded=False):
        st.code("""CREATE TABLE daily_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    minutes_active SMALLINT NOT NULL DEFAULT 0,
    videos_watched SMALLINT NOT NULL DEFAULT 0,
    words_learned SMALLINT NOT NULL DEFAULT 0,
    cards_reviewed SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);""", language="sql")

    with st.expander("12. pipeline_jobs", expanded=False):
        st.code("""CREATE TABLE pipeline_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','stt','translating','definitions','ready','failed')),
    error_message TEXT,
    retry_count SMALLINT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);""", language="sql")

    st.markdown("---")
    st.subheader("Data Flows")

    with st.expander("Word Tap → Flashcard Save"):
        st.markdown("""
1. User watches video (`video_id = X`)
2. `SubtitleOverlay` renders words from `video_words WHERE video_id = X`
3. User taps **"café"**
   - Look up `video_words.vocab_word_id` → `vocab_words` (get `tts_url`, `pinyin`)
   - Look up `video_words.definition_id` → `word_definitions` (get `translation`, `contextual_definition`)
   - Bottom sheet shows: **café** → "coffee" + "The beverage, ordering context" + play audio
4. User taps **Save**
   - `POST /api/v1/flashcards` with `vocab_word_id`, `definition_id`, snapshots
   - Flashcard created with SM-2 defaults (`ease=2.5`, `interval=0`)
   - Saved to MMKV locally + synced to server
        """)

    with st.expander("AI Pipeline (per video)"):
        st.markdown("""
1. Admin uploads video → `pipeline_jobs.status = 'pending'`
2. **STT** (Groq Whisper): extract transcript + word timestamps
   - `INSERT INTO vocab_words (word, language) ON CONFLICT DO NOTHING`
   - `pipeline_jobs.status = 'stt'`
3. **Translation + Definitions** (per native language):
   - Google Translate: bulk translation
   - LLM batch: contextual definitions for all words
   - `INSERT INTO word_definitions ... ON CONFLICT DO NOTHING`
   - `pipeline_jobs.status = 'definitions'`
4. **Link words to video**:
   - `INSERT INTO video_words (video_id, vocab_word_id, definition_id, start_ms, end_ms, ...)`
5. Generate WebVTT → upload to R2
6. `videos.status = 'ready'`, `pipeline_jobs.status = 'ready'`
        """)

    st.markdown("---")
    st.subheader("Row Count Projections (12 months)")
    st.markdown("""
| Table | Month 1 | Month 12 | Growth Driver |
|-------|---------|----------|---------------|
| users | ~100 | ~5,000 | MAU growth |
| videos | 100 | 1,200 | 100 seeded/month |
| vocab_words | ~5,000 | ~15,000 | Unique words across videos |
| word_definitions | ~60,000 | ~180,000 | 15K words × 12 langs |
| video_words | ~5,000 | ~60,000 | ~50 words/video × 1,200 |
| flashcards | ~500 | ~50,000 | ~10 cards/user × 5K users |
| user_views | ~2,000 | ~100,000 | Users × videos watched |
| daily_progress | ~3,000 | ~150,000 | Users × active days |

**Total DB size at 12 months: ~50-100 MB** (Supabase Pro limit: 8 GB)
    """)

    st.subheader("Design Decisions")
    st.markdown("""
1. **Normalized definitions** — `vocab_words` + `word_definitions` instead of JSONB blobs. Same word across videos shares definitions, flashcards reference by FK.
2. **Flashcards reference, don't snapshot** — Cards store FKs to `vocab_words` + `word_definitions` + SRS state. Client MMKV caches display data for offline.
3. **No decks** — Single implicit deck per user in Phase 1. Add deck management in Phase 2.
4. **No subtitles table** — Replaced by `video_words`. WebVTT files are R2 rendering artifacts, not source of truth.
5. **Contextual definitions** — Same word gets different definitions per sentence context ("bank" = river bank vs financial bank).
6. **No tts_cache** — TTS is pre-generated, tracked via `vocab_words.tts_url`.
    """)

with tab6:
    st.header("Implementation Guide")
    st.markdown("Check off steps as you complete them. Progress is saved in your browser session.")
    st.markdown("---")

    # ── Milestone 0: Foundation (DONE) ──
    st.subheader("Milestone 0: Foundation")
    st.caption("Get the project skeleton running")

    st.checkbox("0.1 — Clone kirkwat/tiktok repo, set up Expo project", value=True, key="m0_1")
    st.checkbox("0.2 — Set up Supabase project (create org, project, get keys)", value=True, key="m0_2")
    st.checkbox("0.3 — Integrate Supabase Auth (replace Firebase Auth)", value=True, key="m0_3")
    st.checkbox("0.4 — Supabase OAuth working (Google/Apple login)", value=True, key="m0_4")
    st.checkbox("0.5 — Basic app shell running on device/simulator", value=True, key="m0_5")

    st.markdown("---")

    # ── Milestone 1: Database + User System (DONE) ──
    st.subheader("Milestone 1: Database + User System")
    st.caption("Set up all 14 tables. Wire up user creation, onboarding, and profile. This is the foundation for everything.")

    st.checkbox("1.1 — Run initial migration (all 14 tables from database_design.md)", value=True, key="m1_1")
    st.checkbox("1.2 — Verify tables in Supabase dashboard", value=True, key="m1_2")
    st.checkbox("1.3 — Verify RLS policies are active (test with anon key — should be blocked)", value=True, key="m1_3")
    st.checkbox("1.4 — Create DB trigger: auto-insert users row on auth.users signup", value=True, key="m1_4")
    st.checkbox("1.5 — Test: sign up → user row created automatically", value=True, key="m1_5")
    st.checkbox("1.6 — Onboarding screen: select native language + learning language(s) (R22)", value=True, key="m1_6")
    st.checkbox("1.7 — Save language prefs to users table + Redux (native_language, learning_languages)", value=True, key="m1_7")
    st.checkbox("1.8 — Profile screen: display name, avatar, streak (0), words learned (0), videos watched (0)", value=True, key="m1_8")
    st.checkbox("1.9 — Edit profile: update display_name, avatar_url", value=True, key="m1_9")
    st.checkbox("1.10 — Settings screen: language switcher, daily goal slider", value=True, key="m1_10")
    st.checkbox("1.11 — Own profile screen: display name, avatar, streak, words/videos stats (all 0)", value=True, key="m1_11")
    st.checkbox("1.12 — Empty states for feed, flashcards, progress (placeholder UI)", value=True, key="m1_12")
    st.checkbox("1.13 — Language switching + multi-language support in profile/settings", value=True, key="m1_13")

    with st.expander("1.13 Details: Language switching"):
        st.markdown("""
**What to build:**

1. **Multiple learning languages** — onboarding already saves `learning_languages[]`, but the UI only lets you pick one at a time. Add multi-select so users can learn both English AND Chinese simultaneously.

2. **Active language switcher** — in the feed or settings, a quick toggle to switch `target_language` (which language the feed filters by). This updates `users.target_language` without re-doing onboarding.
   - Example: user learns English + Chinese → toggle between en/zh feeds
   - Could be a pill/chip selector at the top of the feed, or a dropdown in settings

3. **Change native language** — in Profile → Settings, allow changing `native_language`. This changes what language definitions/translations are rendered in.
   - When changed: update `users.native_language` in Supabase
   - Feed stays the same (content language unchanged)
   - Word definitions switch to new native language on next video load
   - Trigger dictionary re-download if offline dictionaries are set up (M8)

4. **Profile language display** — show current native + learning languages on the profile screen (e.g., "Learning: 🇺🇸 English, 🇨🇳 Chinese · Native: 🇪🇸 Spanish")

5. **Language store sync** — when any language pref changes, update both:
   - Redux `languageSlice` (immediate, drives UI)
   - Supabase `users` table (background sync)

**Touches:**
- `src/screens/onboarding/index.tsx` — allow multi-select for learning languages (already supported by data model)
- `src/redux/slices/languageSlice.ts` — add `switchActiveLearning` action
- `src/services/language.ts` — add `updateNativeLanguage()`, `updateActiveLearning()`
- Profile/Settings screen — native language picker, active learning toggle
- Feed screen — filter by `activeLearningLanguage`
        """)

    st.checkbox("1.14 — Seed test users + distribute mock videos across creators for follow/profile testing", value=True, key="m1_14")
    st.checkbox("1.15 — Tappable username in feed overlay → navigate to creator's profile", value=True, key="m1_15")

    with st.expander("M1 Details: What gets wired up and what stays empty"):
        st.markdown("""
#### Tables active after M1

| Table | What to build | Satisfies |
|-------|--------------|-----------|
| `users` | Auto-create on signup (DB trigger). Onboarding sets `native_language` + `learning_languages`. Profile screen shows own stats. Settings updates `daily_goal_minutes`. | R7, R8, R22, R30 |

#### Tables that exist but stay empty (no videos yet)

| Table | Populated when | Why wait |
|-------|---------------|----------|
| `videos` | M2-M3 (R2 setup + pipeline) | Need storage + pipeline first |
| `vocab_words` | M3 (pipeline processes first video) | AI pipeline creates these |
| `word_definitions` | M3 (LLM generates definitions) | AI pipeline creates these |
| `video_words` | M3 (word timestamps from STT/OCR) | AI pipeline creates these |
| `user_likes` / `user_bookmarks` / `comments` | M4 (need videos to interact with) | Can't like/comment without videos |
| `user_follows` | M7 (need other users' profiles visible via videos) | Can't follow users you can't discover |
| `user_views` | M4 (need videos to watch) | Can't track views without videos |
| `flashcards` | M5-M6 (need tappable subtitles first) | Save button lives in WordPopup |
| `daily_progress` | M4+ (need activity to track) | Start tracking when videos exist |
| `pipeline_jobs` | M3 (first pipeline run) | Admin tool creates these |

#### Supabase trigger for auto user creation

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

#### Key decision: Direct Supabase for M1-M9

The app talks to Supabase directly (`@supabase/supabase-js` + PostgREST + RLS) until M10 when the Go backend is built. No API server needed yet.
        """)

    st.markdown("---")

    # ── Milestone 1.5: OCR + Tappable Subtitles Spike ──
    st.subheader("Milestone 1.5: OCR + Tappable Subtitles Spike")
    st.caption("Prove the core feature works end-to-end with ONE video before building the full pipeline. This is the key differentiator — validate early.")

    st.checkbox("1.5.1 — Pick one test video with burned-in Chinese subtitles from assets/videos/", key="m1_5_1")
    st.checkbox("1.5.2 — Python script: extract frames every 500ms with FFmpeg", key="m1_5_2")
    st.checkbox("1.5.3 — OCR: run Google Cloud Vision (or Tesseract) on each frame → raw text per frame", key="m1_5_3")
    st.checkbox("1.5.4 — Deduplicate: collapse consecutive identical text into subtitle segments with start_ms/end_ms", key="m1_5_4")
    st.checkbox("1.5.5 — Chinese word segmentation: run jieba on each subtitle line → individual words with timing", key="m1_5_5")
    st.checkbox("1.5.6 — Generate test translations: use Gemini/GPT to get English translations for each word (one-time, save to JSON)", key="m1_5_6")
    st.checkbox("1.5.7 — Output JSON file: [{word, translation, start_ms, end_ms, part_of_speech}, ...] for the test video", key="m1_5_7")
    st.checkbox("1.5.8 — Build SubtitleOverlay component: render current words based on video playback position", key="m1_5_8")
    st.checkbox("1.5.9 — Make each word individually tappable → show translation in a bottom sheet popup", key="m1_5_9")
    st.checkbox("1.5.10 — Wire into PostSingle for the test video: subtitle overlay synced to expo-video player", key="m1_5_10")
    st.checkbox("1.5.11 — Test on device: verify OCR quality, word timing accuracy, tap UX feels right", key="m1_5_11")

    with st.expander("M1.5 Details: Why spike before pipeline"):
        st.markdown("""
#### Why do this before M2/M3?

The tappable subtitle overlay is **THE core feature** that differentiates Scrollingo from every other video app. If OCR quality is bad, or word timing is off, or the tap UX doesn't feel right, the entire product concept needs rethinking. Better to discover that with a 1-day spike than after building the full pipeline.

#### What this proves

1. **OCR quality**: Can we reliably extract burned-in Chinese text from short-form videos?
2. **Word segmentation**: Does jieba correctly split Chinese sentences into tappable words?
3. **Timing accuracy**: Are word timestamps close enough to feel synced with the video?
4. **UX feel**: Does tapping a word mid-video → seeing a popup feel natural and useful?

#### What this does NOT build

- No database integration (hardcoded JSON, not Supabase)
- No R2 storage (uses local video assets)
- No pipeline automation (manual Python script)
- No LLM contextual definitions (simple translations only)

These all come in M3-M5. This spike is purely about **validating the core UX**.

#### Python dependencies

```bash
pip install google-cloud-vision jieba openai  # or use Tesseract (free) instead of Cloud Vision
brew install tesseract tesseract-lang          # for free local OCR
```

#### Frame extraction

```bash
ffmpeg -i video_2.mp4 -vf "fps=2" -q:v 2 frames/frame_%04d.jpg
```

#### Output format (one JSON file per video)

```json
[
  {"word": "你", "translation": "you", "start_ms": 1000, "end_ms": 1500, "pos": "pronoun"},
  {"word": "好", "translation": "good/hello", "start_ms": 1500, "end_ms": 2000, "pos": "adjective"},
  ...
]
```
        """)

    st.markdown("---")

    # ── Milestone 2: Storage (R2 + CDN) ──
    st.subheader("Milestone 2: Storage (R2 + CDN)")
    st.caption("Set up Cloudflare R2 bucket and verify video delivery. Can be done in parallel with M1.")

    st.checkbox("2.1 — Create Cloudflare account + R2 bucket (scrollingo-media)", key="m2_1")
    st.checkbox("2.2 — Set up custom domain or public bucket URL for CDN access", key="m2_2")
    st.checkbox("2.3 — Create R2 folder structure: videos/, tts/, dictionaries/", key="m2_3")
    st.checkbox("2.4 — Upload one test video manually (720p MP4, ≤60 seconds)", key="m2_4")
    st.checkbox("2.5 — Set Cache-Control headers (immutable for videos/TTS/subs)", key="m2_5")
    st.checkbox("2.6 — Verify video plays in browser via CDN URL", key="m2_6")

    st.markdown("---")

    # ── Milestone 3: First Video End-to-End ──
    st.subheader("Milestone 3: First Video End-to-End (Pipeline)")
    st.caption("Process one video through the AI pipeline. Proves DB + R2 + AI all work together.")

    st.checkbox("3.1 — Get API keys: Groq (Whisper), Gemini (definitions — handles translation + definition + POS in one call)", key="m3_1")
    st.checkbox("3.2 — Insert video row into DB (status='processing', cdn_url from M2)", key="m3_2")
    st.checkbox("3.3 — Insert pipeline_jobs row (status='pending')", key="m3_3")
    st.checkbox("3.4 — Extract audio from video with FFmpeg → upload audio.mp3 to R2", key="m3_4")
    st.checkbox("3.5 — STT: send audio to Groq Whisper → get transcript with word-level timestamps", key="m3_5")
    st.checkbox("3.6 — Insert unique words into vocab_words (ON CONFLICT DO NOTHING)", key="m3_6")
    st.checkbox("3.7 — LLM Definitions: batch call Gemini Flash for all words × 1 native lang (generates translation + contextual_definition + POS in one call)", key="m3_7")
    st.checkbox("3.8 — Insert word_definitions into DB (vocab_word_id, video_id, target_language)", key="m3_8")
    st.checkbox("3.9 — Insert video_words into DB (timestamps linked to vocab_words)", key="m3_9_new")
    st.checkbox("3.10 — Update video status='ready', pipeline_jobs status='ready'", key="m3_10_new")
    st.checkbox("3.11 — Verify: query video_words JOIN vocab_words JOIN word_definitions — all data correct", key="m3_11_new")

    with st.expander("M3 Details: Pipeline script approach"):
        st.markdown("""
This can be a standalone Python or Go script — NOT the full Go backend (that's M10). The goal is to prove the pipeline works end-to-end with one video.

**Recommended: Python script** (faster to prototype, can become the admin CLI later)

```python
# pipeline.py — process a single video
python3 pipeline.py --video-url https://cdn.scrollingo.com/videos/test/video.mp4 \\
                     --language en --native-lang es
```

**Order matters:** Create the video DB row FIRST (3.2), then process it (3.4-3.10), then mark it ready (3.11). This matches the real pipeline flow.

**Start with 1 native language** (e.g., Spanish) to keep it simple. Expand to all 12 in M11.
        """)

    st.markdown("---")

    # ── Milestone 4: Video Feed in App ──
    st.subheader("Milestone 4: Video Feed in App")
    st.caption("Display videos from M3 in the app. Optimized for TikTok-style rapid swiping (15-20 skips before a full watch).")

    st.checkbox("4.1 — Query videos from Supabase (WHERE status='ready' AND language=target_language, LEFT JOIN user_views to exclude watched)", key="m4_1")
    st.checkbox("4.2 — Wire up feedSlice (Redux Toolkit) with cursor pagination (10-15 items/page, fetch next page when 3-5 from end)", key="m4_2")
    st.checkbox("4.3 — Adapt PostSingle to use videos table data directly (cdn_url, thumbnail_url) — NOT a mapping layer", key="m4_3")
    st.checkbox("4.4 — Thumbnail placeholders: show thumbnail_url as <Image> behind <VideoView> to eliminate black flash on swipe", key="m4_4")
    st.checkbox("4.5 — Prefetch next 2 videos: pre-initialize expo-video players for N+1 and N+2 while current video plays", key="m4_5")
    st.checkbox("4.6 — Auto play/pause based on scroll visibility (onViewableItemsChanged) — already working with local videos", key="m4_6")
    st.checkbox("4.7 — Track views: INSERT/UPDATE user_views on watch (buffered, not every frame)", key="m4_7")
    st.checkbox("4.8 — Test: app plays videos from R2 CDN, <200ms time-to-first-frame on swipe, smooth rapid swiping", key="m4_8")

    with st.expander("M4 Details: TikTok-style playback optimization"):
        st.markdown("""
#### Why prefetch matters

A typical TikTok session: swipe → watch 2s → swipe → watch 1s → swipe → swipe → swipe → watch 30s → swipe...

Without prefetch, each swipe triggers: new player creation → HTTP connection → download from byte 0 → decode first frame → **500ms-2s black screen on LTE**. This feels broken.

#### Thumbnail placeholder (4.4)

Show `thumbnail_url` as a React Native `<Image>` behind the `<VideoView>`. The thumbnail renders instantly (cached by the Image component), so the user never sees a black screen. When the video player's first frame is ready, it paints over the thumbnail seamlessly.

```tsx
<View style={styles.container}>
  <Image source={{ uri: video.thumbnail_url }} style={StyleSheet.absoluteFill} />
  <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" />
</View>
```

#### Prefetch strategy (4.5)

While the user watches video N, pre-initialize `useVideoPlayer` for videos N+1 and N+2. The native player starts buffering immediately (HTTP range request for the first few hundred KB). When the user swipes, the first frame is already decoded → **<200ms time-to-first-frame**.

Options:
- Increase FlatList `windowSize` so adjacent items render (and their players initialize)
- Or manage a prefetch pool: create players for upcoming URLs, hand them off when the item renders

#### Bandwidth awareness (Phase 2)

Each skipped 30s video (8MB) wastes ~2-3MB in 3s of buffering. Over 20 swipes = 40-60MB waste. Acceptable for Phase 1. Phase 2 options:
- Serve 480p initially, upgrade to 720p after 3s watch time
- HLS with fast-start low-quality segment (Phase 3)

#### Pagination (4.2)

Keyset cursor pagination — NOT offset-based. Feed query returns 10-15 records per page:
```sql
SELECT id, cdn_url, thumbnail_url, like_count, ...
FROM videos
WHERE language = $1 AND status = 'ready'
  AND (created_at, id) < ($cursor_ts, $cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT 15;
```
Trigger next page fetch when user is 3-5 items from the end of the current page.
        """)

    st.markdown("---")

    # ── Milestone 5: Tappable Subtitles (Core Feature) ──
    st.subheader("Milestone 5: Tappable Subtitles")
    st.caption("THE core language learning feature. User taps a word → sees translation + definition.")

    st.checkbox("5.1 — Fetch all subtitle data for video: video_words JOIN vocab_words JOIN word_definitions (single query, filtered by user's native_language)", key="m5_1")
    st.checkbox("5.2 — Build SubtitleOverlay component: render current sentence's words based on playback position", key="m5_2")
    st.checkbox("5.3 — Highlight active word as video plays (sync word_index to currentTime)", key="m5_3")
    st.checkbox("5.4 — Make each word individually tappable (onPress per word)", key="m5_4")
    st.checkbox("5.5 — Build WordPopup bottom sheet (@gorhom/bottom-sheet): translation, contextual definition, POS", key="m5_5")
    st.checkbox("5.6 — TTS in popup: expo-speech for instant pronunciation (R2 audio available after M12, expo-speech only until then)", key="m5_6")
    st.checkbox("5.7 — Pause video when popup opens, resume on close", key="m5_7")
    st.checkbox("5.8 — Test: tap word in subtitle → correct translation in user's native language + audio plays", key="m5_8")

    with st.expander("M5 Details: The subtitle data query"):
        st.markdown("""
**One query loads everything the subtitle overlay needs:**

```sql
SELECT vw.word_index, vw.display_text, vw.start_ms, vw.end_ms,
       v.word, v.tts_url, v.pinyin,
       wd.translation, wd.contextual_definition, wd.part_of_speech
FROM video_words vw
JOIN vocab_words v ON v.id = vw.vocab_word_id
JOIN word_definitions wd ON wd.vocab_word_id = vw.vocab_word_id
    AND wd.video_id = vw.video_id
    AND wd.target_language = $user_native_language
WHERE vw.video_id = $video_id
ORDER BY vw.word_index;
```

This returns ~50 rows per video. The app caches this per video — no extra queries on word tap. The WordPopup just reads from the already-loaded data.
        """)

    st.markdown("---")

    # ── Milestone 6: Flashcard Save + Review ──
    st.subheader("Milestone 6: Flashcards")
    st.caption("Save words from videos, review with spaced repetition.")

    st.checkbox("6.1 — Add 'Save' button in WordPopup → INSERT flashcard (vocab_word_id, definition_id, source_video_id)", key="m6_1")
    st.checkbox("6.2 — Dedup: UNIQUE index prevents saving same word+definition twice, show 'Saved' state", key="m6_2")
    st.checkbox("6.3 — Implement SM-2 algorithm (lib/sm2.ts)", key="m6_3")
    st.checkbox("6.4 — Build FlashcardReview screen: show word, flip to reveal translation + definition", key="m6_4")
    st.checkbox("6.5 — SRS controls: Again / Hard / Good / Easy → update ease_factor, interval, next_review", key="m6_5")
    st.checkbox("6.6 — Fetch due cards from Supabase: flashcards JOIN vocab_words JOIN word_definitions WHERE next_review <= now()", key="m6_6")
    st.checkbox("6.7 — Build flashcardStore (Zustand + MMKV): cache cards locally for offline review", key="m6_7")
    st.checkbox("6.8 — Offline sync: queue SRS updates in MMKV, bulk sync to server on reconnect (client_updated_at for conflict resolution)", key="m6_8")

    st.markdown("---")

    # ── Milestone 7: Social Features ──
    st.subheader("Milestone 7: Social Features")
    st.caption("Likes, comments, bookmarks. Depends on M4 (need videos to interact with).")

    st.checkbox("7.1 — Like button on video card: toggle INSERT/DELETE user_likes + optimistic like_count update", key="m7_1")
    st.checkbox("7.2 — Bookmark button: toggle INSERT/DELETE user_bookmarks", key="m7_2")
    st.checkbox("7.3 — Comment modal: fetch comments by video (cursor pagination), post new comment", key="m7_3")
    st.checkbox("7.4 — 'My Bookmarks' screen: list saved videos", key="m7_4")
    st.checkbox("7.5 — Show like/comment/bookmark counts on video cards", key="m7_5")
    st.checkbox("7.6 — Other user profile screen: tap creator name on video → view their profile", key="m7_6")
    st.checkbox("7.7 — Follow/unfollow button on other users' profiles (user_follows table)", key="m7_7")
    st.checkbox("7.8 — Follower/following counts on profiles", key="m7_8")

    st.markdown("---")

    # ── Milestone 8: Language System (Advanced) ──
    st.subheader("Milestone 8: Language System (Advanced)")
    st.caption("Offline dictionaries, adapter factory, auto-download. Basic language selection is in M1.")

    st.checkbox("8.1 — Offline dictionary: download SQLite files from R2 on first launch", key="m8_1")
    st.checkbox("8.2 — DictionaryFactory: route (sourceLang, targetLang) → correct adapter", key="m8_2")
    st.checkbox("8.3 — SimpleDictAdapter: lookup word in local SQLite (written_rep → trans_list)", key="m8_3")
    st.checkbox("8.4 — ChineseSourceAdapter: handle simplified/traditional + pinyin", key="m8_4")
    st.checkbox("8.5 — LlmWrapperAdapter: merge local dict result with cached LLM definition", key="m8_5")
    st.checkbox("8.6 — RemoteApiAdapter: fallback for missing offline pairs (queries word_definitions from Supabase; switches to Go API after M10)", key="m8_6")
    st.checkbox("8.7 — Auto-download new dictionaries when user changes language", key="m8_7")
    st.checkbox("8.8 — Test: word tap works with offline dictionary (airplane mode)", key="m8_8")

    st.markdown("---")

    # ── Milestone 9: Progress & Streaks ──
    st.subheader("Milestone 9: Progress & Streaks")
    st.caption("Track learning activity, maintain daily streaks. Depends on M4+ (need activity to track).")

    st.checkbox("9.1 — Track activity client-side: videos_watched (M4), words_learned (M6), cards_reviewed (M6)", key="m9_1")
    st.checkbox("9.2 — UPSERT daily_progress row on each session (increment counters for today)", key="m9_2")
    st.checkbox("9.3 — Streak logic: if today's date > streak_last_date + 1 day → reset to 1, else increment", key="m9_3")
    st.checkbox("9.4 — Update longest_streak when current streak beats it", key="m9_4")
    st.checkbox("9.5 — Progress dashboard screen: streak badge, words learned, videos watched, cards reviewed", key="m9_5")
    st.checkbox("9.6 — Daily goal ring: minutes_active vs daily_goal_minutes (animated progress ring)", key="m9_6")

    st.markdown("---")

    # ── Milestone 10: Go Backend ──
    st.subheader("Milestone 10: Go Backend")
    st.caption("Build the Go monolith on fly.io. Centralizes API logic, runs the AI pipeline.")

    st.checkbox("10.1 — Scaffold Go project: chi router, Supabase DB connection, health endpoint", key="m10_1")
    st.checkbox("10.2 — JWT middleware: verify Supabase tokens (JWKS caching)", key="m10_2")
    st.checkbox("10.3 — Feed endpoint: GET /api/v1/feed (chronological, keyset pagination)", key="m10_3")
    st.checkbox("10.4 — Video words endpoint: GET /api/v1/videos/:id/words (returns words + definitions)", key="m10_4")
    st.checkbox("10.5 — Flashcard endpoints: GET due, POST create, PUT review, POST sync", key="m10_5")
    st.checkbox("10.6 — Social endpoints: likes, comments, bookmarks, follows", key="m10_6")
    st.checkbox("10.7 — Progress endpoints: GET stats, POST daily sync", key="m10_7")
    st.checkbox("10.8 — Admin endpoints: POST /internal/admin/videos (trigger pipeline)", key="m10_8")
    st.checkbox("10.9 — Port M3 pipeline script into Go as async goroutines (replaces the standalone script)", key="m10_9")
    st.checkbox("10.10 — Background workers: view count flush, streak calculation", key="m10_10")
    st.checkbox("10.11 — Rate limiting middleware", key="m10_11")
    st.checkbox("10.12 — Deploy to fly.io, verify health check", key="m10_12")
    st.checkbox("10.13 — Switch React Native app from direct Supabase to Go API", key="m10_13")

    st.markdown("---")

    # ── Milestone 11: Content Pipeline (Batch) ──
    st.subheader("Milestone 11: Content Pipeline (Batch)")
    st.caption("Scale from 1 test video to 100 videos/month.")

    st.checkbox("11.1 — Admin CLI tool: scrollingo-admin upload (FFmpeg normalize + R2 upload + trigger)", key="m11_1")
    st.checkbox("11.2 — Batch STT: process multiple videos in queue", key="m11_2")
    st.checkbox("11.3 — OCR path: detect burned-in subtitles, extract via Cloud Vision", key="m11_3")
    st.checkbox("11.4 — Batch LLM definitions: all words × 12 native languages per video", key="m11_4")
    st.checkbox("11.5 — Generate WebVTT subtitle files → upload to R2", key="m11_5")
    st.checkbox("11.6 — Pipeline status tracking: pipeline_jobs table, retry on failure", key="m11_6")
    st.checkbox("11.7 — Seed 10 videos, verify feed works with multiple videos", key="m11_7")
    st.checkbox("11.8 — Seed 100 videos across English + Chinese content", key="m11_8")

    st.markdown("---")

    # ── Milestone 12: TTS Pre-generation ──
    st.subheader("Milestone 12: TTS Pre-generation")
    st.caption("Pre-generate pronunciation audio for all words. One-time batch job.")

    st.checkbox("12.1 — Get word frequency lists for English (~100K words) and Chinese (~100K)", key="m12_1")
    st.checkbox("12.2 — Write batch script: word list → Google Neural2 TTS → MP3 files", key="m12_2")
    st.checkbox("12.3 — Upload TTS audio to R2: tts/{language}/{sha256}.mp3", key="m12_3")
    st.checkbox("12.4 — Update vocab_words.tts_url for all generated words", key="m12_4")
    st.checkbox("12.5 — Verify: tap word → expo-speech instant + R2 high-quality audio loads", key="m12_5")

    st.markdown("---")

    # ── Milestone 13: Polish & Launch Prep ──
    st.subheader("Milestone 13: Polish & Launch Prep")
    st.caption("Final polish before beta launch.")

    st.checkbox("13.1 — Error handling: network errors, empty states, loading skeletons", key="m13_1")
    st.checkbox("13.2 — Monitoring: set up Axiom (logs) + Sentry (errors) for Go backend + app", key="m13_2")
    st.checkbox("13.3 — CI/CD: GitHub Actions for Go deploy, EAS Build for app", key="m13_3")
    st.checkbox("13.4 — Database migrations: set up golang-migrate, version the schema", key="m13_4")
    st.checkbox("13.5 — App Store assets: screenshots, description, privacy policy", key="m13_5")
    st.checkbox("13.6 — TestFlight / internal testing build", key="m13_6")
    st.checkbox("13.7 — Load test: verify feed + word lookup performance at 100 concurrent users", key="m13_7")
    st.checkbox("13.8 — Security audit: verify RLS, rate limits, admin endpoint protection", key="m13_8")
    st.checkbox("13.9 — Beta launch to first 100 users", key="m13_9")

    st.markdown("---")
    st.subheader("Milestone Summary")
    st.markdown("""
| Milestone | What | Depends On | Effort |
|-----------|------|-----------|--------|
| **M0** | Foundation (React Native + Supabase Auth) | — | **Done** |
| **M1** | Database + user system + onboarding + profile | M0 | **Done** |
| **M1.5** | OCR + tappable subtitles spike (validate core UX) | M1 | 1 day |
| **M2** | R2 Storage + CDN (can parallel with M1.5) | — | 1 hour |
| **M3** | First video end-to-end (pipeline script) | M1.5, M2 | 1-2 days |
| **M4** | Video feed in app + thumbnails + prefetch + view tracking | M3 | 2-3 days |
| **M5** | Tappable subtitles + word popup (production version) | M4, M1.5 | 1-2 days |
| **M6** | Flashcard save + SM-2 review + offline | M5 | 2-3 days |
| **M7** | Social (likes, comments, bookmarks, follows, profiles) | M4 | 2-3 days |
| **M8** | Offline dictionaries + adapter factory | M5 | 3-5 days |
| **M9** | Progress tracking + streaks | M4, M6 | 1-2 days |
| **M10** | Go backend (centralize API + port pipeline) | M1, M2, M3 | 5-7 days |
| **M11** | Content pipeline (batch 100 videos) | M10 | 3-5 days |
| **M12** | TTS pre-generation (can run anytime after M2) | M2 | 1 day |
| **M13** | Polish & launch | All above | 3-5 days |

**Critical path**: M0 → M1 → **M1.5** → M2 → M3 → M4 → M5 (first magic moment: tap word → see definition)

**Parallel work**:
- M2 can run in parallel with M1.5
- M1.5 spike de-risks M5 — if OCR quality or UX is bad, pivot before investing in pipeline
- M7 (social) can start after M4
- M9 (progress) can start after M6
- M12 (TTS) can run anytime after M2 — doesn't block anything
    """)

with tab7:
    st.header("OCR Research: PaddleOCR for Subtitle Extraction")
    st.markdown("PaddleOCR PP-OCRv5 is the clear winner for extracting burned-in subtitles from TikTok-style videos. "
                "This tab covers the PaddleOCR ecosystem: model versions, open-source video subtitle tools built on it, "
                "and our recommended pipeline.")
    st.markdown("---")

    # --- Why PaddleOCR ---
    st.subheader("Why PaddleOCR")
    col_w1, col_w2 = st.columns(2)
    with col_w1:
        st.markdown("""
**Best Chinese accuracy of any OCR engine.** PP-OCRv5 handles simplified, traditional, and pinyin in a single unified model. Only 70M parameters yet outperforms GPT-4o, Gemini, and Qwen2.5-VL-72B on OCR benchmarks.

**Essentially free.** Self-hosted, Apache 2.0 license. At 6,000 frames/month, processing takes ~5 minutes on a GPU.

**Built-in text detection.** DB/DB++ detector finds subtitle regions automatically and returns 4-point polygon bounding boxes.

**Battle-tested.** Multiple open-source projects already use PaddleOCR specifically for extracting hardcoded subtitles from video frames.
        """)
    with col_w2:
        st.markdown("""
| Spec | Detail |
|------|--------|
| GitHub | 72,600+ stars |
| Languages | 106 (en, es, zh, ja, ko, and 101 more) |
| Detection | Built-in DB/DB++ |
| BBox output | Line-level polygons, word-level via `return_word_box` |
| Latency | ~30-80ms/frame (GPU), ~200-500ms (CPU) |
| VRAM | 2-4 GB (server model) |
| Install | `pip install paddleocr paddlepaddle` |
| License | Apache 2.0 |
| Latest | PP-OCRv5 (May 2025), PaddleOCR 3.0.3 (June 2025) |
        """)

    st.markdown("---")

    # --- PP-OCR Version History ---
    st.subheader("PP-OCR Model Versions")

    st.markdown("""
| Version | Year | Key Innovation | Det Model | Rec Model |
|---------|------|----------------|-----------|-----------|
| **PP-OCRv1** | 2020 | Foundational release, MobileNetV3 backbone | — | CRNN |
| **PP-OCRv2** | 2021 | Knowledge distillation, expanded languages | — | Enhanced CRNN |
| **PP-OCRv3** | 2022 | SVTR+LCNet recognition replacing CRNN | 2.1 MB (mobile) | ~9.6 MB (mobile) |
| **PP-OCRv4** | 2023 | Server/mobile model split, PP-HGNetV2 backbone | 4.7 MB / 109 MB | 10.5 MB / 182 MB |
| **PP-OCRv5** | 2025 | **Unified multilingual, 13% accuracy gain, dual-branch GTC-NRTR + SVTR-HGNet** | 4.7 MB / 84.3 MB | 16 MB / 81 MB |
    """)

    with st.expander("PP-OCRv5 Details", expanded=True):
        st.markdown("""
PP-OCRv5 is a significant leap over v4:

- **Unified model:** Handles Simplified Chinese, Traditional Chinese, Pinyin, English, and Japanese in a single model (no separate language models needed for these 5)
- **Dual-branch architecture:** GTC-NRTR + SVTR-HGNet with PFHead and DSR (Dynamic Spatial Refinement)
- **13% accuracy improvement** over PP-OCRv4 across all scenarios
- **30%+ improvement** for non-CJK multilingual text (Spanish, French, etc.)
- **26% error reduction** on handwriting
- **Only 70M parameters** — smaller than v4 server rec (182 MB → 81 MB) while being more accurate

#### Accuracy by Scenario (Server Model)

| Scenario | PP-OCRv5 | PP-OCRv4 | Improvement |
|----------|----------|----------|-------------|
| Printed Chinese | **90.1%** | 85.2% | +4.9% |
| Printed English | **86.8%** | 82.4% | +4.4% |
| Traditional Chinese | **74.7%** | 68.1% | +6.6% |
| Distortion | **93.1%** | 89.2% | +3.9% |
| Rotation | **74.4%** | 67.3% | +7.1% |
| Artistic/Stylized Text | **64.0%** | 55.8% | +8.2% |
| **Average** | **84.0%** | 77.1% | **+6.9%** |

*Note: These are strict line-level accuracy (any wrong character = entire line wrong). Character-level accuracy is much higher.*
        """)

    with st.expander("Server vs Mobile Models"):
        st.markdown("""
| | Server | Mobile |
|---|---|---|
| **Detection** | 84.3 MB, 83.8% accuracy | 4.7 MB, 79.0% accuracy |
| **Recognition** | 81 MB, 84.0% avg accuracy | 16 MB, 80.2% avg accuracy |
| **Best for** | Server-side batch processing (our pipeline) | On-device, edge, real-time |
| **GPU** | Recommended | Optional (runs fast on CPU) |

**For Scrollingo:** Use PP-OCRv5 server models for maximum accuracy in the subtitle extraction pipeline.
        """)

    with st.expander("Key Parameters for Video Subtitle Extraction"):
        st.markdown("""
| Parameter | Default | Recommendation | Why |
|-----------|---------|----------------|-----|
| `use_angle_cls` | False | **False** | Subtitles are horizontal; angle classification adds latency for no benefit |
| `det_db_thresh` | 0.3 | **0.25** | Lower threshold catches subtitles with semi-transparent backgrounds |
| `det_db_box_thresh` | 0.5 | **0.6** | Reduces false positives from video noise/watermarks |
| `rec_batch_num` | 6 | **16-32** | Process more text regions in parallel; subtitles usually have few boxes per frame |
| `return_word_box` | False | **False** | Word-level boxes not needed; we use jieba for Chinese segmentation |
| `use_gpu` | False | **True** | Essential for batch processing speed |
| `det_limit_side_len` | 960 | **1280** | TikTok videos are 1080px wide; ensure detection sees full resolution |
| `lang` | 'ch' | `'ch'` for Chinese (also handles English), `'latin'` for Spanish | Chinese model handles en+zh; Spanish needs latin model |
        """)

    with st.expander("PaddleOCR 3.x Framework Changes"):
        st.markdown("""
PaddleOCR 3.0 (May 2025) is a major rewrite of the framework:

| Change | Old (2.x) | New (3.x) |
|--------|-----------|-----------|
| API | `PaddleOCR()` class with `ocr()` method | `TextDetection` and `TextRecognition` modules |
| CLI | `paddleocr --image_dir ...` | `paddleocr ocr --input <path>` |
| Results | Nested list traversal | `res.print()`, `res.save_to_json()`, `res.save_to_img()` |
| ONNX | `use_onnx=True` parameter | Removed (replaced by high-performance inference) |
| New model | — | **PaddleOCR-VL** (0.9B params) — vision-language OCR achieving 94.5% on OmniDocBench v1.5 (Jan 2026) |

**For Scrollingo M1.5 spike:** The 2.x API still works and is simpler. Use `from paddleocr import PaddleOCR` as shown in the code examples. Migrate to 3.x API when building the production pipeline (M3/M10).
        """)

    st.markdown("---")

    # --- Open Source Projects ---
    st.subheader("PaddleOCR Video Subtitle Projects")
    st.markdown("These open-source tools implement the exact pipeline we need: video → frames → PaddleOCR → deduplicated subtitles with timing.")

    with st.expander("VideOCR — RECOMMENDED reference (timminator/VideOCR)", expanded=True):
        st.markdown("""
The most feature-complete and actively maintained project. **Last commit: March 11, 2026 (9 days ago).**

| Spec | Detail |
|------|--------|
| GitHub | `timminator/VideOCR` — 453 stars, 41 forks |
| License | MIT |
| Latest release | v1.4.1 (Feb 23, 2026) |
| PaddleOCR version | 3.x / PP-OCRv5 |
| Python | 3.9+ |

**Pipeline:**
1. Frame extraction via **PyAV** (not raw OpenCV) — better codec support
2. **VFR (variable frame rate) handling** via MediaInfo timestamp parsing — critical for TikTok videos which are often VFR
3. **SSIM deduplication** via `fast_ssim` — intelligently samples only the subtitle region for comparison, reducing false positives from background video changes
4. PaddleOCR 3.x CLI subprocess for OCR
5. Post-processing: **WordNinja** word segmentation for English, Spanish, Portuguese, German, Italian, French
6. **Simplified Chinese normalization** option
7. **Dual subtitle zone** support (e.g., bilingual Chinese + English on same video)
8. Fuzzy text matching for merging similar consecutive lines
9. Output: SRT with optional ASS alignment tags

**Key advantages over other projects:**
- SSIM dedup (far superior to pixel diff)
- VFR support (TikTok videos are often variable frame rate)
- Dual subtitle zones (bilingual Chinese + English)
- Latin language word segmentation built in
- Simplified Chinese normalization
- Active maintenance

**API:**
```python
from videocr import get_subtitles, save_subtitles_to_file

# Get subtitles as SRT string
srt = get_subtitles(
    "video.mp4",
    lang="ch",               # PaddleOCR language
    sim_threshold=85,         # SSIM threshold (%)
    conf_threshold=60,        # OCR confidence threshold (%)
    use_gpu=True,
)

# Or save directly to file
save_subtitles_to_file(
    "video.mp4", "output.srt",
    lang="ch", use_gpu=True,
)
```

**Limitation:** Runs PaddleOCR as a subprocess (not in-process). For server integration, extract core logic and call PaddleOCR Python API directly.
        """)

    with st.expander("video-subtitle-extractor (YaoFANGUK) — Most popular"):
        st.markdown("""
The most popular project by far (8,519 stars) with a full GUI. Best for manual/desktop use.

| Spec | Detail |
|------|--------|
| GitHub | `YaoFANGUK/video-subtitle-extractor` — 8,519 stars, 869 forks |
| License | Apache 2.0 |
| Last push | Aug 2025 |
| Languages | 87 (Chinese + English bilingual mode) |

**Features:**
- **Auto subtitle region detection** via deep learning (no manual cropping needed — unique among these tools)
- Three modes: Fast (lightweight model), Auto (adaptive), Accurate (frame-by-frame)
- GUI (desktop app) and CLI
- Pre-built binaries for Windows and macOS
- `typoMap.json` for OCR error correction (e.g., "l'm" → "I'm")
- Watermark removal
- Batch processing

**Limitations:**
- **Not a library** — structured as a standalone app, not pip-installable
- 234 open issues (significant user-reported problems)
- Paths cannot contain Chinese characters or spaces
- Heavy dependencies (PaddlePaddle 3.0.0rc1)
- Python 3.12+ only
- Documentation primarily in Chinese

**Best for:** Desktop users doing manual subtitle extraction. Less suitable as a library to integrate into our pipeline.
        """)

    with st.expander("videocr-PaddleOCR (devmaxxing) — Simplest library"):
        st.markdown("""
The simplest pip-installable library. Fork of original `videocr` with PaddleOCR replacing Tesseract.

| Spec | Detail |
|------|--------|
| GitHub | `devmaxxing/videocr-PaddleOCR` — 221 stars, 34 forks |
| License | MIT |
| Last push | Aug 2025 |
| PaddleOCR version | 2.x |

**Pipeline:**
1. Frame extraction via OpenCV `cv2.VideoCapture`
2. **Pixel-diff deduplication** (grayscale `cv2.absdiff`, binary threshold, count non-zero pixels)
3. PaddleOCR 2.x in-process for OCR
4. Multi-line grouping by Y-coordinate position
5. Output: SRT string or file

**API:**
```python
from videocr import get_subtitles
srt = get_subtitles(
    "video.mp4", lang="ch",
    sim_threshold=90,
    conf_threshold=65,
    use_gpu=True,
)
```

**Limitations:**
- Pixel-diff dedup (less accurate than SSIM)
- No VFR support
- No word segmentation post-processing
- Uses older PaddleOCR 2.x
- Manual subtitle region cropping only
- Smaller community

**Best for:** Quick prototyping and M1.5 spike — simplest possible integration, pip-installable, PaddleOCR runs in-process.
        """)

    with st.expander("RapidVideOCR (SWHL) — Two-stage with VideoSubFinder"):
        st.markdown("""
OCR-only tool designed to pair with VideoSubFinder for a two-stage pipeline.

| Spec | Detail |
|------|--------|
| GitHub | `SWHL/RapidVideOCR` — 491 stars, 58 forks |
| License | Apache 2.0 |
| Latest release | v3.1.1 (June 2025) |
| PyPI | `rapid_videocr` |
| Backend | RapidOCR (ONNX Runtime, not PaddlePaddle) |

**Two-stage pipeline:**
1. **VideoSubFinder** (separate C++ app) detects subtitle keyframes → outputs cropped images
2. **RapidVideOCR** runs OCR on those images → outputs SRT/ASS/TXT

**Key distinction:** Uses **RapidOCR** (ONNX Runtime) instead of PaddlePaddle directly. Lighter dependency, but may be 2-3x slower for detection.

**Limitations:**
- Requires VideoSubFinder (separate C++ binary install)
- Not a standalone pipeline
- Documentation primarily in Chinese

**Best for:** Maximum accuracy when paired with VideoSubFinder's specialized subtitle detection. More complex setup.
        """)

    with st.expander("VidSubX (voun7) — Newest, ONNX-based"):
        st.markdown("""
Newest project, very actively maintained.

| Spec | Detail |
|------|--------|
| GitHub | `voun7/VidSubX` — 67 stars, 10 forks |
| License | Not specified |
| Last push | **March 19, 2026 (yesterday)** |
| Latest release | v2.2 (March 6, 2026) |
| Backend | PaddleOCR via ONNX Runtime |

**Features:**
- GUI with frame-by-frame navigation for precise region selection
- Manual subtitle region selection via mouse
- Batch processing
- Light/dark themes
- Windows and Linux

**Limitations:** GUI-focused, not a library. No Chinese word segmentation. Manual region selection only.
        """)

    st.markdown("---")

    # --- Project Comparison ---
    st.subheader("Project Comparison")

    st.markdown("""
| Feature | VideOCR | video-subtitle-extractor | videocr-PaddleOCR | RapidVideOCR | VidSubX |
|---------|---------|--------------------------|-------------------|--------------|---------|
| **Stars** | 453 | 8,519 | 221 | 491 | 67 |
| **Last active** | **Mar 2026** | Aug 2025 | Aug 2025 | Sep 2025 | **Mar 2026** |
| **PaddleOCR ver** | **3.x / v5** | 3.0rc | **2.x** | ONNX | ONNX |
| **Full pipeline** | Yes | Yes | Yes | No (OCR only) | Yes |
| **Frame dedup** | **SSIM** | Text similarity | Pixel diff | Via VideoSubFinder | Unknown |
| **VFR support** | **Yes** | Unknown | No | N/A | Unknown |
| **Auto subtitle detection** | No | **Yes (DL)** | No | Via VideoSubFinder | Manual |
| **Dual subtitle zones** | **Yes** | No | No | No | No |
| **Word segmentation** | **6 Latin langs** | No | No | No | No |
| **Chinese normalization** | **Yes** | No | No | No | No |
| **Output** | SRT (+ASS) | SRT, TXT | SRT | SRT, ASS, TXT | SRT |
| **Python library** | Semi (subprocess) | No (app) | **Yes (pip, in-process)** | **Yes (pip)** | No (app) |
| **Install** | Medium | High | **Low** | Low | Medium |
    """)

    st.markdown("---")

    # --- Pipeline Optimizations ---
    st.subheader("Pipeline Optimization Techniques")

    with st.expander("SSIM Frame Deduplication (skip ~70% of frames)"):
        st.markdown("""
Subtitles persist across multiple consecutive frames. VideOCR uses **SSIM** with an important optimization: it compares only the **subtitle region** of the frame (not the whole frame), preventing false positives from background video changes.

**Impact:** Reduces OCR processing by ~70%.

| | Frames extracted | Unique frames (after dedup) | OCR time (GPU) |
|---|---|---|---|
| Phase 1 (100 videos) | 6,000 | ~1,800 | ~1.5 min |
| Phase 2 (1,000 videos) | 60,000 | ~18,000 | ~15 min |

```python
from fast_ssim import ssim  # VideOCR's approach
import cv2

def is_new_subtitle(frame1, frame2, subtitle_region, threshold=0.85):
    # Crop to subtitle region only
    y1, y2, x1, x2 = subtitle_region
    crop1 = cv2.cvtColor(frame1[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    crop2 = cv2.cvtColor(frame2[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    return ssim(crop1, crop2) < threshold
```
        """)

    with st.expander("LLM Post-Correction (95% error correction)"):
        st.markdown("""
The **GhostCut** project (`JollyToday/Extract-Subtitles-by-OCR`) demonstrates that running OCR output through an LLM proofreader corrects **95% of OCR errors**.

**Cost:** Gemini 2.5 Flash at $0.10/M input tokens — proofreading all subtitle text from 100 videos costs **< $0.10/month**.

```python
# Post-correction for low-confidence OCR results
prompt = f\"\"\"Fix any OCR errors in this {language} subtitle text.
Previous line: {prev_line}
Current line: {ocr_text} (confidence: {confidence:.0%})
Next line: {next_line}
Return only the corrected text.\"\"\"
corrected = gemini_flash(prompt)
```

**When to use:** Apply to low-confidence results (< 0.90) or all results for maximum accuracy.
        """)

    st.markdown("---")

    # --- Recommendation ---
    st.subheader("Recommended Pipeline for Scrollingo")

    st.success("**PaddleOCR PP-OCRv5 server models** — use VideOCR as reference implementation")

    col_r1, col_r2 = st.columns(2)
    with col_r1:
        st.markdown("""
**Architecture:**
```
Video (TikTok 9:16, 720p)
  → PyAV frame extraction (2fps)
  → SSIM dedup on subtitle region
    (~70% frames skipped)
  → PaddleOCR PP-OCRv5 server
    (detect + recognize)
  → Gemini Flash post-correction
    (low-confidence only, < $0.10/mo)
  → Fuzzy text merge (consecutive dupes)
  → Segments: {text, start_ms, end_ms}
  → jieba segmentation (Chinese)
  → WordNinja segmentation (English/Spanish)
  → Store in video_words table
```
        """)
    with col_r2:
        st.markdown("""
**Monthly cost:**

| | Phase 1 (100 vids) | Phase 2 (1K vids) |
|---|---|---|
| PaddleOCR | ~$0 (self-hosted) | ~$1-7 (spot GPU) |
| Gemini post-correction | < $0.10 | < $1 |
| **Total OCR** | **< $0.10/mo** | **< $8/mo** |

**Model selection by language:**

| Language | Model |
|----------|-------|
| Chinese + English | PP-OCRv5 server rec (`lang='ch'`) |
| Spanish | PP-OCRv5 server rec (`lang='latin'`) |
| Detection (all) | PP-OCRv5 server det (84.3 MB) |
        """)

    st.markdown("""
**Implementation approach:**

1. **M1.5 spike:** Use `videocr-PaddleOCR` (simplest pip install, PaddleOCR runs in-process) to validate OCR quality on one test video
2. **M3 pipeline:** Extract core logic from VideOCR (SSIM dedup, VFR handling, word segmentation) and call PaddleOCR Python API directly
3. **M10 Go backend:** Run PaddleOCR as a Python subprocess from Go, or wrap in a small FastAPI service

**What to take from each project:**

| From | Take |
|------|------|
| **VideOCR** | SSIM dedup on subtitle region, VFR handling via PyAV/MediaInfo, WordNinja segmentation, simplified Chinese normalization, dual subtitle zone support |
| **videocr-PaddleOCR** | Simple in-process PaddleOCR API pattern, multi-line Y-coordinate grouping |
| **video-subtitle-extractor** | `typoMap.json` OCR error correction patterns, auto subtitle region detection concept |
| **GhostCut** | LLM post-correction pipeline for 95% error reduction |
    """)

    st.markdown("---")
    st.subheader("M1.5 Spike: Quick Start")
    st.markdown("""
```bash
# Install (no API keys needed)
pip install paddleocr paddlepaddle opencv-python jieba

# Or use videocr-PaddleOCR for the full pipeline
pip install git+https://github.com/devmaxxing/videocr-PaddleOCR.git
```

**Option A: Full pipeline via videocr-PaddleOCR**
```python
from videocr import get_subtitles

srt = get_subtitles(
    "assets/videos/video_2.mp4",
    lang="ch",
    sim_threshold=90,
    conf_threshold=65,
    use_gpu=False,  # CPU for dev, GPU for prod
)
print(srt)
# Output: SRT format with timestamps
```

**Option B: Frame-by-frame with raw PaddleOCR**
```python
from paddleocr import PaddleOCR
import cv2, jieba, json

ocr = PaddleOCR(lang='ch', use_angle_cls=False,
                det_db_thresh=0.25, det_db_box_thresh=0.6,
                det_limit_side_len=1280)

cap = cv2.VideoCapture("assets/videos/video_2.mp4")
fps = cap.get(cv2.CAP_PROP_FPS)
frame_interval = int(fps / 2)  # 2fps
subtitles = []
frame_num = 0

while True:
    ret, frame = cap.read()
    if not ret:
        break
    if frame_num % frame_interval != 0:
        frame_num += 1
        continue

    result = ocr.ocr(frame, cls=False)
    timestamp_ms = int((frame_num / fps) * 1000)

    if result and result[0]:
        for line in result[0]:
            bbox, (text, conf) = line
            if conf > 0.65:
                words = list(jieba.cut(text))
                subtitles.append({
                    "text": text,
                    "words": words,
                    "confidence": round(conf, 3),
                    "timestamp_ms": timestamp_ms,
                    "bbox": bbox,
                })
    frame_num += 1

cap.release()

# Save for SubtitleOverlay component
with open("assets/subtitles/video_2_ocr.json", "w") as f:
    json.dump(subtitles, f, ensure_ascii=False, indent=2)
```
    """)

    st.markdown("---")
    st.caption("Research conducted March 2026. Sources: PaddleOCR GitHub (72.6K stars), PP-OCRv5 technical report (arXiv), "
               "VideOCR/videocr-PaddleOCR/RapidVideOCR/video-subtitle-extractor GitHub repos, "
               "GhostCut (JollyToday/Extract-Subtitles-by-OCR), CC-OCR benchmark (ICCV 2025), "
               "PaddleOCR 3.0 upgrade notes.")
