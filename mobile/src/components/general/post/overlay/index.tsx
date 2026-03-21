import { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Video } from "../../../../../types";
import { useDispatch } from "react-redux";
import { throttle } from "throttle-debounce";
import { AppDispatch } from "../../../../redux/store";
import { openCommentModal } from "../../../../redux/slices/modalSlice";

export default function PostSingleOverlay({
  video,
}: {
  video: Video;
}) {
  const insets = useSafeAreaInsets();
  const dispatch: AppDispatch = useDispatch();

  const [currentLikeState, setCurrentLikeState] = useState({
    state: false,
    counter: video.like_count,
  });
  const [currentCommentsCount, setCurrentCommentsCount] = useState(
    video.comment_count,
  );

  const handleUpdateLike = useMemo(
    () =>
      throttle(500, (currentLikeStateInst: typeof currentLikeState) => {
        setCurrentLikeState({
          state: !currentLikeStateInst.state,
          counter:
            currentLikeStateInst.counter +
            (currentLikeStateInst.state ? -1 : 1),
        });
        // Real likes will be implemented in M7 when videos have DB rows
      }),
    [],
  );

  const handleUpdateCommentCount = () => {
    setCurrentCommentsCount((prev) => prev + 1);
  };

  return (
    <View style={styles.container} pointerEvents="box-none" testID="overlay-container">
      {/* Bottom gradient for text readability */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.7)"]}
        style={styles.gradient}
        pointerEvents="none"
      />

      {/* Right side: vertical action buttons */}
      <View style={styles.actionsColumn} pointerEvents="box-none" testID="actions-column">
        {/* Like */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleUpdateLike(currentLikeState)}
        >
          <Ionicons
            name={currentLikeState.state ? "heart" : "heart-outline"}
            size={35}
            color={currentLikeState.state ? "#fe2c55" : "white"}
          />
          <Text style={styles.actionText}>{currentLikeState.counter}</Text>
        </TouchableOpacity>

        {/* Comment */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() =>
            dispatch(
              openCommentModal({
                open: true,
                data: { id: video.id, creator: "", media: [], description: video.description ?? "", likesCount: video.like_count, commentsCount: video.comment_count, creation: video.created_at },
                modalType: 0,
                onCommentSend: handleUpdateCommentCount,
              }),
            )
          }
        >
          <Ionicons name="chatbubble-ellipses" size={33} color="white" />
          <Text style={styles.actionText}>{currentCommentsCount}</Text>
        </TouchableOpacity>

        {/* Share */}
        <TouchableOpacity style={styles.actionButton}>
          <Ionicons name="arrow-redo" size={33} color="white" />
          <Text style={styles.actionText}>Share</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom left: title + description */}
      <View style={[styles.textContainer, { paddingBottom: 16 + insets.bottom }]} testID="text-container">
        <Text style={styles.displayName} testID="display-name">
          {video.title}
        </Text>
        {video.description && (
          <Text style={styles.description} numberOfLines={2} testID="description">
            {video.description}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    justifyContent: "flex-end",
  },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 300,
  },
  actionsColumn: {
    position: "absolute",
    right: 8,
    bottom: 120,
    alignItems: "center",
    width: 60,
  },
  actionButton: {
    alignItems: "center",
    marginBottom: 20,
  },
  actionText: {
    color: "white",
    fontSize: 12,
    marginTop: 2,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  textContainer: {
    paddingLeft: 16,
    paddingRight: 80,
    paddingBottom: 16,
  },
  displayName: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  description: {
    color: "white",
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
