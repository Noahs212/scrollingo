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
            graph [bgcolor="transparent", fontname="Helvetica", label="Phase 1: Video Distribution + Social + Language Learning UI", fontsize=22, fontcolor="#333", nodesep=0.7, ranksep=1.0, labelloc=t];
            node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11, color="#d0d0d0", fontcolor="#333"];
            edge [fontname="Helvetica", fontsize=9, color="#999"];

            // ── Mobile Client ──
            subgraph cluster_client {
                label="React Native + Expo (iOS / Android)\\nBase: kirkwat/tiktok";
                style="rounded,filled";
                fillcolor="#e8f0fe";
                color="#4a86c8";
                fontcolor="#1a3a5c";
                fontsize=13;

                AppFeed [label="Video Feed\\n(FlashList + Preload)\\nexpo-video", fillcolor="#c6dafc"];
                AppFlashcards [label="Flashcards\\n(Offline SRS)\\nMMKV + Zustand", fillcolor="#c6dafc"];
                AppTTS [label="On-Device\\nTTS / STT\\nexpo-speech", fillcolor="#c6dafc"];
                AppQuiz [label="Mid-Scroll Quiz\\n(Phase 1.5)", fillcolor="#dce4f2"];
            }

            // ── fly.io ──
            subgraph cluster_flyio {
                label="fly.io";
                style="rounded,filled";
                fillcolor="#e6f4ea";
                color="#34a853";
                fontcolor="#1e4620";
                fontsize=13;

                subgraph cluster_go {
                    label="Go Monolith";
                    style="rounded,filled";
                    fillcolor="#ceead6";
                    color="#34a853";
                    fontcolor="#1e4620";
                    fontsize=11;

                    API [label="REST API\\n/api/v1/*", fillcolor="#a8dab5"];
                    FeedEngine [label="Feed Engine\\nPhase 1: Chronological\\nPhase 1.5: Scored", fillcolor="#a8dab5"];
                    Dict [label="Dictionary\\n(cached lookups)", fillcolor="#a8dab5"];
                    Pipeline [label="AI Pipeline\\n(goroutines)", fillcolor="#a8dab5"];
                    Workers [label="Background Workers\\n(view flush, cleanup)", fillcolor="#a8dab5"];
                    Cache [label="In-Memory Cache\\n(sync.Map)", fillcolor="#a8dab5"];
                }
            }

            // ── Supabase ──
            subgraph cluster_supabase {
                label="Supabase";
                style="rounded,filled";
                fillcolor="#fef7e0";
                color="#ea8600";
                fontcolor="#5c3d00";
                fontsize=13;

                PostgreSQL [label="PostgreSQL\\n(15 tables, RLS)", shape=cylinder, fillcolor="#fce8b2"];
                SupaAuth [label="Auth\\n(JWT, OAuth)", fillcolor="#fce8b2"];
                Realtime [label="Realtime\\n(WebSocket)", fillcolor="#fce8b2"];
            }

            // ── Cloudflare ──
            subgraph cluster_cloudflare {
                label="Cloudflare";
                style="rounded,filled";
                fillcolor="#fce4ec";
                color="#d93025";
                fontcolor="#5c1018";
                fontsize=13;

                R2 [label="R2 Storage\\n(Videos + TTS Cache)", shape=folder, fillcolor="#f8bbd0"];
                CDN [label="CDN\\n(Free Egress)", fillcolor="#f8bbd0"];
            }

            // ── AI Providers ──
            subgraph cluster_ai {
                label="AI Providers (Pay-per-use)";
                style="rounded,filled";
                fillcolor="#f3e8fd";
                color="#7c3aed";
                fontcolor="#3b1a6e";
                fontsize=13;

                STT [label="Groq Whisper\\n($0.000667/min)", shape=box, peripheries=2, fillcolor="#e0cffc"];
                TTS [label="Google Neural2\\n($0.016/1K chars)", shape=box, peripheries=2, fillcolor="#e0cffc"];
                Trans [label="Google Translate\\n($20/M chars)", shape=box, peripheries=2, fillcolor="#e0cffc"];
            }

            // ── Monitoring ──
            subgraph cluster_monitoring {
                label="Monitoring (Free Tier)";
                style="rounded,filled";
                fillcolor="#f5f5f5";
                color="#999";
                fontcolor="#555";
                fontsize=11;

                Axiom [label="Axiom\\n(Logs)", fillcolor="#e8e8e8"];
                Sentry [label="Sentry\\n(Errors)", fillcolor="#e8e8e8"];
                Grafana [label="Grafana Cloud\\n(Metrics)", fillcolor="#e8e8e8"];
            }

            // ── Client to Backend ──
            AppFeed -> API [label="GET /feed\\n(cursor pagination)", color="#4a86c8"];
            AppFlashcards -> API [label="POST /progress/sync\\n+ POST /flashcards/*", color="#4a86c8", style=dashed];
            AppQuiz -> API [label="POST /quiz/submit\\n(track progress)", color="#4a86c8", style=dashed];
            AppFlashcards -> AppTTS [label="Pronounce\\nwords", color="#4a86c8", style=dotted];
            AppFeed -> AppTTS [label="Tap word\\npronunciation", color="#4a86c8", style=dotted];

            // ── Client to Cloudflare (direct) ──
            AppFeed -> CDN [label="Stream\\nMP4", color="#d93025"];

            // ── Client Auth ──
            AppFeed -> SupaAuth [label="Login / Signup\\n(get JWT)", color="#ea8600", style=dotted];
            Realtime -> AppFeed [label="Video Ready\\nNotification", color="#ea8600", style=dashed];

            // ── Backend to Data ──
            API -> PostgreSQL [label="Queries", color="#ea8600"];
            API -> Cache [label="Read/Write\\n(TTL-based)", color="#34a853"];
            API -> FeedEngine [label="Assemble feed", color="#34a853", style=dotted];
            FeedEngine -> PostgreSQL [label="Phase 1: chronological\\nPhase 1.5: scored\\n(recency + popularity\\n+ difficulty + novelty)", color="#ea8600"];
            FeedEngine -> Cache [label="Cache\\nfeed page", color="#34a853", style=dotted];
            API -> Dict [label="Word lookup", color="#34a853", style=dotted];
            Dict -> Cache [label="Cache\\ndict entries", color="#34a853", style=dotted];
            Dict -> PostgreSQL [label="Query", color="#ea8600", style=dotted];
            API -> SupaAuth [label="Verify JWT\\n(cached JWKS)", color="#ea8600", style=dotted];
            Workers -> PostgreSQL [label="Flush views\\nclean stale jobs", color="#ea8600", style=dotted];

            // ── Realtime trigger ──
            PostgreSQL -> Realtime [label="Row change\\n(status=ready)", color="#ea8600", style=dashed];

            // ── Backend to Storage ──
            API -> R2 [label="Presigned URLs", color="#d93025"];
            R2 -> CDN [label="Origin", color="#d93025"];

            // ── AI Pipeline (async) ──
            Pipeline -> STT [label="1. Transcribe", color="#7c3aed", style=dashed];
            Pipeline -> Trans [label="2. Translate", color="#7c3aed", style=dashed];
            Pipeline -> R2 [label="Store subtitles", color="#d93025", style=dashed];

            // TTS is on-demand for vocab lookups, not part of video pipeline
            Dict -> TTS [label="Vocab word\\npronunciation\\n(cache-first)", color="#7c3aed", style=dashed];
            Pipeline -> PostgreSQL [label="Update Status", color="#ea8600", style=dashed];

            // ── Monitoring ──
            API -> Axiom [style=dotted, color="#999"];
            API -> Sentry [style=dotted, color="#999"];
            Pipeline -> Sentry [label="Pipeline errors", style=dotted, color="#999"];
            API -> Grafana [style=dotted, color="#999"];
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
tab1, tab2, tab3, tab4, tab5 = st.tabs(["Financial Dashboard", "System Architecture", "Cost Optimizer", "Phase 1 Requirements", "Database Design"])

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
    st.graphviz_chart(get_architecture_diagram(lean_mode=lean_mode), use_container_width=True)

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

    st.subheader("Language Learning UI")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R10 | Tappable subtitle overlay synced to video playback |
| R11 | Tap any word → bottom sheet with translation, contextual definition, part of speech, pronunciation |
| R12 | Lookup direction: video language → user's native language (always) |
| R13 | Save any word as a flashcard (from word tap or subtitle context) |
| R14 | Flashcard review with SM-2 spaced repetition algorithm |
| R15 | Flashcards work offline (MMKV persistence, sync on reconnect) |
| R16 | On-device TTS for instant word pronunciation (expo-speech, free) |
| R17 | High-quality pre-generated TTS audio from R2 for flashcard review |
    """)

    st.subheader("Language System")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R18 | User sets one native language + one or more learning languages |
| R19 | Learning languages (Phase 1): **English, Chinese** |
| R20 | Native languages (12): en, es, zh, ja, ko, hi, fr, de, pt, ar, it, ru |
| R21 | English and Chinese can be both learning AND native |
| R22 | Offline bilingual dictionaries (SQLite, ~20 pairs), auto-downloaded on language change |
| R23 | Chinese dictionaries handle simplified/traditional characters + pinyin |
| R24 | LLM contextual definitions for every word in every video, per native language |
| R25 | Dictionary adapter factory with fallback to remote API for missing offline pairs |
    """)

    st.subheader("Progress")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R26 | Daily streak tracking with streak badges |
| R27 | Stats dashboard: words learned, videos watched, cards reviewed |
| R28 | Daily activity sync to server |
    """)

    st.subheader("Content Pipeline (Backend)")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R29 | Admin CLI uploads video → triggers AI pipeline |
| R30 | Pipeline: STT (Groq Whisper) → Translation (Google) → Contextual Definitions (LLM) → store in R2 |
| R31 | Pre-generated TTS for all ~100K words per learning language, stored in R2 |
| R32 | Videos marked "ready" after pipeline completes; Supabase Realtime notifies clients |
    """)

    st.markdown("---")
    st.subheader("Phase 1.5 (Deferred)")
    st.markdown("""
| ID | Requirement |
|----|-------------|
| R33 | Feed scoring algorithm (Krashen's i+1 difficulty matching) |
| R34 | Personalized feed using recency, popularity, difficulty match, novelty |
| R35 | Mid-scroll quiz cards interleaved in feed |
| R36 | Quiz generation from user's learned vocabulary |
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
