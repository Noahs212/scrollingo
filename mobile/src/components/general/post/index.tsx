// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TouchableWithoutFeedback,
  View,
  Image,
  StyleSheet,
  Animated,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { Video } from "../../../../types";
import { useUser } from "../../../hooks/useUser";
import { useSelector } from "react-redux";
import { RootState } from "../../../redux/store";
import { useSaveFlashcard } from "../../../hooks/useSaveFlashcard";
import PostSingleOverlay from "./overlay";
import SubtitleTapOverlay, { HighlightRange } from "./subtitleOverlay";
import VisibleSubtitleOverlay from "./visibleSubtitleOverlay";
import WordPopup, { WordPopupData } from "./wordPopup";
import { useSubtitles } from "../../../hooks/useSubtitles";
import { useWordDefinitions } from "../../../hooks/useWordDefinitions";
import * as Haptics from "expo-haptics";

export interface PostSingleHandles {
  play: () => void;
  stop: () => void;
  unload: () => void;
}

const DOUBLE_TAP_DELAY = 300;

export const PostSingle = forwardRef<PostSingleHandles, { item: Video }>(
  ({ item }, parentRef) => {
    const user = useUser(item.creator_id).data;
    const nativeLanguage = useSelector(
      (state: RootState) => state.language.nativeLanguage,
    );
    const devMuted = useSelector(
      (state: RootState) => state.language.devMuted,
    );
    const { data: wordDefs } = useWordDefinitions(item.id, nativeLanguage);
    const saveFlashcard = useSaveFlashcard();
    const [isPaused, setIsPaused] = useState(false);
    const [popupData, setPopupData] = useState<WordPopupData | null>(null);
    const [popupVisible, setPopupVisible] = useState(false);
    const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
    const [highlightRange, setHighlightRange] = useState<HighlightRange | null>(null);
    const lastTapRef = useRef(0);
    const pauseOpacity = useRef(new Animated.Value(0)).current;
    const heartScale = useRef(new Animated.Value(0)).current;
    const heartOpacity = useRef(new Animated.Value(0)).current;
    const [showHeart, setShowHeart] = useState(false);
    const playerRef = useRef<ReturnType<typeof useVideoPlayer> | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    const isSTT = item.subtitle_source === "stt";

    // Fetch subtitle bounding boxes from R2 CDN
    const { data: subtitleData } = useSubtitles(item.id, item.cdn_url);

    const player = useVideoPlayer(item.cdn_url, (p) => {
      p.loop = true;
      p.timeUpdateEventInterval = 0.05;
    });

    // Event-driven time tracking from native side — replaces setInterval polling
    const { currentTime } = useEvent(player, "timeUpdate", {
      currentTime: 0,
      currentLiveTimestamp: 0,
      currentOffsetFromLive: 0,
      bufferedPosition: 0,
    });
    const currentTimeMs = currentTime * 1000;

    useEffect(() => {
      playerRef.current = player;
    }, [player]);

    useEffect(() => {
      try { player.muted = devMuted; } catch {}
    }, [devMuted, player]);

    useImperativeHandle(parentRef, () => ({
      play: () => {
        try {
          player.play();
          setIsPaused(false);
        } catch (e) {
          // Player may be released
        }
      },
      stop: () => {
        try {
          player.pause();
        } catch (e) {
          // Player may be released
        }
      },
      unload: () => {
        try {
          player.pause();
        } catch (e) {
          // Player may be released
        }
      },
    }));

    // Time tracking is now event-driven via useEvent above — no polling needed

    const showPauseIndicator = useCallback(() => {
      Animated.sequence([
        Animated.timing(pauseOpacity, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(pauseOpacity, {
          toValue: 0,
          duration: 800,
          delay: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }, [pauseOpacity]);

    const showHeartAnimation = useCallback(() => {
      setShowHeart(true);
      heartScale.setValue(0);
      heartOpacity.setValue(1);

      Animated.sequence([
        Animated.spring(heartScale, {
          toValue: 1,
          friction: 3,
          tension: 150,
          useNativeDriver: true,
        }),
        Animated.timing(heartOpacity, {
          toValue: 0,
          duration: 400,
          delay: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setShowHeart(false));
    }, [heartScale, heartOpacity]);

    const handleTap = useCallback(() => {
      const now = Date.now();
      const timeSinceLastTap = now - lastTapRef.current;

      if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
        showHeartAnimation();
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
        setTimeout(() => {
          if (lastTapRef.current === now) {
            try {
              if (isPaused) {
                player.play();
                setIsPaused(false);
              } else {
                player.pause();
                setIsPaused(true);
              }
              showPauseIndicator();
            } catch (e) {
              // Player may be released
            }
          }
        }, DOUBLE_TAP_DELAY);
      }
    }, [isPaused, player, showPauseIndicator, showHeartAnimation]);

    return (
      <View
        style={styles.container}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setContainerSize({ width, height });
        }}
      >
        {/* Thumbnail placeholder — shows instantly while video buffers */}
        {item.thumbnail_url && (
          <Image
            source={{ uri: item.thumbnail_url }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />
        )}

        {/* Video fills the entire container — paints over thumbnail when ready */}
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
        />

        {/* Tap target for play/pause — behind the overlay buttons */}
        <TouchableWithoutFeedback onPress={handleTap}>
          <View style={styles.tapTarget} />
        </TouchableWithoutFeedback>

        {/* Pause/Play indicator */}
        <Animated.View
          style={[styles.centerIndicator, { opacity: pauseOpacity }]}
          pointerEvents="none"
        >
          <Ionicons
            name={isPaused ? "pause" : "play"}
            size={80}
            color="rgba(255,255,255,0.8)"
          />
        </Animated.View>

        {/* Double-tap heart animation */}
        {showHeart && (
          <Animated.View
            style={[
              styles.centerIndicator,
              {
                opacity: heartOpacity,
                transform: [{ scale: heartScale }],
              },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="heart" size={120} color="white" />
          </Animated.View>
        )}

        {/* Visible subtitle text for STT-sourced videos */}
        {isSTT && subtitleData && containerSize.width > 0 && (
          <VisibleSubtitleOverlay
            subtitleData={subtitleData}
            currentTimeMs={currentTimeMs}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            highlightRange={highlightRange}
            onWordTap={(word, fullText, tapX, tapY, detectionIndex, charIndex) => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              try { player.pause(); setIsPaused(true); } catch {}

              setPopupPosition({ x: tapX, y: tapY });

              // Direct word-level match (simpler than OCR char-index matching)
              let match = wordDefs?.find(
                (wd) =>
                  wd.display_text === word &&
                  currentTimeMs >= wd.start_ms - 2000 &&
                  currentTimeMs < wd.end_ms + 2000,
              );
              if (!match) {
                match = wordDefs?.find((wd) => wd.display_text === word);
              }

              if (match) {
                setHighlightRange({
                  detectionIndex,
                  startCharIndex: charIndex,
                  endCharIndex: charIndex + match.display_text.length,
                });
                setPopupData({
                  word: match.word,
                  pinyin: match.pinyin,
                  translation: match.translation,
                  contextual_definition: match.contextual_definition,
                  part_of_speech: match.part_of_speech,
                  source_sentence: fullText,
                  vocab_word_id: match.vocab_word_id,
                  definition_id: match.definition_id,
                });
              } else {
                setHighlightRange({
                  detectionIndex,
                  startCharIndex: charIndex,
                  endCharIndex: charIndex + word.length,
                });
                setPopupData({
                  word,
                  pinyin: null,
                  translation: "",
                  contextual_definition: "",
                  part_of_speech: null,
                  source_sentence: fullText,
                  vocab_word_id: "",
                  definition_id: "",
                });
              }
              setPopupVisible(true);
            }}
          />
        )}

        {/* Invisible subtitle tap targets — over the burned-in text (OCR only) */}
        {!isSTT && subtitleData && containerSize.width > 0 && (
          <SubtitleTapOverlay
            subtitleData={subtitleData}
            currentTimeMs={currentTimeMs}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            highlightRange={highlightRange}
            onCharTap={(char, fullText, tapX, tapY, detectionIndex, charIndex) => {
              // Haptic feedback
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

              // Pause video
              try {
                player.pause();
                setIsPaused(true);
              } catch {
                // Player may be released
              }

              // Compute word center X from OCR data
              let wordCenterX = tapX;
              if (subtitleData) {
                const segment = subtitleData.segments.find(
                  (seg) => seg.detections.some((det) => det.text === fullText),
                );
                if (segment) {
                  const det = segment.detections.find((d) => d.text === fullText);
                  if (det) {
                    const { scale, offsetX } = (() => {
                      const vW = subtitleData.resolution.width;
                      const vH = subtitleData.resolution.height;
                      const cW = containerSize.width;
                      const cH = containerSize.height;
                      const vAspect = vW / vH;
                      const cAspect = cW / cH;
                      if (vAspect > cAspect) {
                        return { scale: cW / vW, offsetX: 0 };
                      }
                      return { scale: cH / vH, offsetX: (cW - vW * (cH / vH)) / 2 };
                    })();

                    // Find the word containing the tapped character index
                    const wordText = wordDefs?.find((wd) => {
                      const idx = fullText.indexOf(wd.display_text);
                      if (idx < 0) return false;
                      // Check all occurrences to find the one containing charIndex
                      let searchFrom = 0;
                      while (searchFrom <= fullText.length) {
                        const pos = fullText.indexOf(wd.display_text, searchFrom);
                        if (pos < 0) break;
                        if (charIndex >= pos && charIndex < pos + wd.display_text.length) return true;
                        searchFrom = pos + 1;
                      }
                      return false;
                    })?.display_text ?? char;
                    // Find the occurrence of wordText that contains charIndex
                    let startIdx = -1;
                    let searchFrom = 0;
                    while (searchFrom <= fullText.length) {
                      const pos = fullText.indexOf(wordText, searchFrom);
                      if (pos < 0) break;
                      if (charIndex >= pos && charIndex < pos + wordText.length) {
                        startIdx = pos;
                        break;
                      }
                      searchFrom = pos + 1;
                    }
                    if (startIdx < 0) startIdx = fullText.indexOf(wordText);
                    if (startIdx >= 0 && startIdx < det.chars.length) {
                      const endIdx = Math.min(startIdx + wordText.length, det.chars.length);
                      const firstChar = det.chars[startIdx];
                      const lastChar = det.chars[endIdx - 1];
                      const x0 = firstChar.x * scale + offsetX;
                      const x1 = (lastChar.x + lastChar.width) * scale + offsetX;
                      wordCenterX = (x0 + x1) / 2;
                    }
                  }
                }
              }

              setPopupPosition({ x: wordCenterX, y: tapY });

              // Look up the word that contains this character
              if (wordDefs && wordDefs.length > 0) {
                // Match word definition where the tapped charIndex falls within
                // an occurrence of the word in fullText
                let match = wordDefs.find((wd) => {
                  let searchFrom = 0;
                  while (searchFrom <= fullText.length) {
                    const pos = fullText.indexOf(wd.display_text, searchFrom);
                    if (pos < 0) break;
                    if (charIndex >= pos && charIndex < pos + wd.display_text.length) {
                      // Also check time overlap
                      return currentTimeMs >= wd.start_ms - 2000 && currentTimeMs < wd.end_ms + 2000;
                    }
                    searchFrom = pos + 1;
                  }
                  return false;
                });
                // Fallback: text-only match by charIndex position
                if (!match) {
                  match = wordDefs.find((wd) => {
                    let searchFrom = 0;
                    while (searchFrom <= fullText.length) {
                      const pos = fullText.indexOf(wd.display_text, searchFrom);
                      if (pos < 0) break;
                      if (charIndex >= pos && charIndex < pos + wd.display_text.length) return true;
                      searchFrom = pos + 1;
                    }
                    return false;
                  });
                }
                if (match) {
                  // Find the specific occurrence containing charIndex for highlight
                  let wordStart = charIndex;
                  let searchFrom = 0;
                  while (searchFrom <= fullText.length) {
                    const pos = fullText.indexOf(match.display_text, searchFrom);
                    if (pos < 0) break;
                    if (charIndex >= pos && charIndex < pos + match.display_text.length) {
                      wordStart = pos;
                      break;
                    }
                    searchFrom = pos + 1;
                  }
                  setHighlightRange({
                    detectionIndex,
                    startCharIndex: wordStart,
                    endCharIndex: wordStart + match.display_text.length,
                  });
                  setPopupData({
                    word: match.word,
                    pinyin: match.pinyin,
                    translation: match.translation,
                    contextual_definition: match.contextual_definition,
                    part_of_speech: match.part_of_speech,
                    source_sentence: fullText,
                    vocab_word_id: match.vocab_word_id,
                    definition_id: match.definition_id,
                  });
                  setPopupVisible(true);
                  return;
                }
              }

              // Fallback: highlight just the tapped character
              setHighlightRange({
                detectionIndex,
                startCharIndex: charIndex,
                endCharIndex: charIndex + 1,
              });
              setPopupData({
                word: char,
                pinyin: null,
                translation: "",
                contextual_definition: "",
                part_of_speech: null,
                source_sentence: fullText,
                vocab_word_id: "",
                definition_id: "",
              });
              setPopupVisible(true);
            }}
          />
        )}

        {/* Word translation popup */}
        <WordPopup
          data={popupData}
          visible={popupVisible}
          language={item.language}
          tapX={popupPosition.x}
          tapY={popupPosition.y}
          onClose={() => {
            setPopupVisible(false);
            setHighlightRange(null);
          }}
          onSave={(data) => {
            console.log("[SaveFlashcard] onSave fired:", data.word, data.vocab_word_id, data.definition_id);
            if (data.vocab_word_id && data.definition_id) {
              saveFlashcard.mutate({
                vocabWordId: data.vocab_word_id,
                definitionId: data.definition_id,
                sourceVideoId: item.id,
                language: item.language,
              });
            }
          }}
        />

        {/* Overlay: action buttons + video info + creator */}
        <PostSingleOverlay video={item} user={user ?? null} />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  tapTarget: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  centerIndicator: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
});

export default PostSingle;
