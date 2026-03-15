// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  TouchableWithoutFeedback,
  View,
  StyleSheet,
  Animated,
  Dimensions,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { Post } from "../../../../types";
import { useUser } from "../../../hooks/useUser";
import PostSingleOverlay from "./overlay";

export interface PostSingleHandles {
  play: () => void;
  stop: () => void;
  unload: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

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

    const videoUrl = item.media?.[0] ?? null;
    const player = useVideoPlayer(videoUrl, (p) => {
      p.loop = true;
    });

    // Store player in ref for cleanup safety
    useEffect(() => {
      playerRef.current = player;
    }, [player]);

    useImperativeHandle(parentRef, () => ({
      play: () => {
        try {
          player.play();
          setIsPaused(false);
        } catch (e) {
          // Player may be released — safe to ignore
        }
      },
      stop: () => {
        try {
          player.pause();
        } catch (e) {
          // Player may be released — safe to ignore
        }
      },
      unload: () => {
        try {
          player.pause();
        } catch (e) {
          // Player may be released — safe to ignore
        }
      },
    }));

    // Cleanup: no-op since expo-video manages player lifecycle
    useEffect(() => {
      return () => {
        // Do NOT call player.pause() here — the player object
        // may already be released by expo-video, causing a crash.
        // expo-video handles cleanup automatically when the
        // VideoView unmounts.
      };
    }, []);

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
        // Double tap — like
        showHeartAnimation();
        lastTapRef.current = 0;
      } else {
        // Single tap — toggle play/pause (with delay to check for double)
        lastTapRef.current = now;
        setTimeout(() => {
          if (lastTapRef.current === now) {
            // No second tap happened
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
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={handleTap}>
          <View style={styles.videoContainer}>
            <VideoView
              player={player}
              style={styles.video}
              contentFit="cover"
              nativeControls={false}
            />

            {/* Pause/Play indicator */}
            <Animated.View
              style={[styles.pauseIndicator, { opacity: pauseOpacity }]}
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
                  styles.heartAnimation,
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
          </View>
        </TouchableWithoutFeedback>

        {user && <PostSingleOverlay user={user} post={item} />}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  videoContainer: {
    flex: 1,
  },
  video: {
    flex: 1,
  },
  pauseIndicator: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  heartAnimation: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
});

export default PostSingle;
