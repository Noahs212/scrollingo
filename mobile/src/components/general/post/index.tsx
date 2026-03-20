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
  StyleSheet,
  Animated,
  Alert,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { Post } from "../../../../types";
import { useUser } from "../../../hooks/useUser";
import PostSingleOverlay from "./overlay";
import SubtitleTapOverlay from "./subtitleOverlay";
import { getSubtitleData } from "../../../services/subtitles";

export interface PostSingleHandles {
  play: () => void;
  stop: () => void;
  unload: () => void;
}

const DOUBLE_TAP_DELAY = 300;

export const PostSingle = forwardRef<PostSingleHandles, { item: Post }>(
  ({ item }, parentRef) => {
    const user = useUser(item.creator).data;
    const [isPaused, setIsPaused] = useState(false);
    const lastTapRef = useRef(0);
    const pauseOpacity = useRef(new Animated.Value(0)).current;
    const heartScale = useRef(new Animated.Value(0)).current;
    const heartOpacity = useRef(new Animated.Value(0)).current;
    const [showHeart, setShowHeart] = useState(false);
    const playerRef = useRef<ReturnType<typeof useVideoPlayer> | null>(null);
    const subtitleData = getSubtitleData(item.id);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    const videoUrl = item.media?.[0] ?? null;
    const player = useVideoPlayer(videoUrl, (p) => {
      p.loop = true;
      // Enable native time update events at ~50ms intervals (fires from
      // AVPlayer's addPeriodicTimeObserver on iOS — no JS polling needed)
      if (subtitleData) {
        p.timeUpdateEventInterval = 0.05;
      }
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
        {/* Video fills the entire container */}
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

        {/* Invisible subtitle tap targets — over the burned-in text */}
        {subtitleData && containerSize.width > 0 && (
          <SubtitleTapOverlay
            subtitleData={subtitleData}
            currentTimeMs={currentTimeMs}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            onCharTap={(char, fullText) => {
              try {
                player.pause();
                setIsPaused(true);
              } catch {
                // Player may be released
              }
              Alert.alert(char, `From: "${fullText}"`);
            }}
          />
        )}

        {/* Overlay: action buttons + user info — renders ON TOP of tap target */}
        {user && <PostSingleOverlay user={user} post={item} />}
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
