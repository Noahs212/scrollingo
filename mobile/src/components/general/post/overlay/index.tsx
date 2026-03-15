// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Post, User } from "../../../../../types";
import { useDispatch, useSelector } from "react-redux";
import { throttle } from "throttle-debounce";
import { getLikeById, updateLike } from "../../../../services/posts";
import { AppDispatch, RootState } from "../../../../redux/store";
import { openCommentModal } from "../../../../redux/slices/modalSlice";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../../navigation/main";
import { Avatar } from "react-native-paper";

export default function PostSingleOverlay({
  user,
  post,
}: {
  user: User;
  post: Post;
}) {
  const insets = useSafeAreaInsets();
  const currentUser = useSelector(
    (state: RootState) => state.auth.currentUser,
  );
  const dispatch: AppDispatch = useDispatch();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [currentLikeState, setCurrentLikeState] = useState({
    state: false,
    counter: post.likesCount,
  });
  const [currentCommentsCount, setCurrentCommentsCount] = useState(
    post.commentsCount,
  );

  useEffect(() => {
    if (currentUser) {
      getLikeById(post.id, currentUser.uid).then((res) => {
        setCurrentLikeState((prev) => ({
          ...prev,
          state: res,
        }));
      });
    }
  }, []);

  const handleUpdateLike = useMemo(
    () =>
      throttle(500, (currentLikeStateInst: typeof currentLikeState) => {
        setCurrentLikeState({
          state: !currentLikeStateInst.state,
          counter:
            currentLikeStateInst.counter +
            (currentLikeStateInst.state ? -1 : 1),
        });
        if (currentUser) {
          updateLike(post.id, currentUser.uid, currentLikeStateInst.state);
        }
      }),
    [],
  );

  const handleUpdateCommentCount = () => {
    setCurrentCommentsCount((prev) => prev + 1);
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Bottom gradient for text readability */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.7)"]}
        style={styles.gradient}
        pointerEvents="none"
      />

      {/* Right side: vertical action buttons — positioned in lower-center */}
      <View style={styles.actionsColumn} pointerEvents="box-none">
        {/* Avatar with follow badge */}
        <TouchableOpacity
          style={styles.avatarContainer}
          onPress={() =>
            navigation.navigate("profileOther", {
              initialUserId: user?.uid ?? "",
            })
          }
        >
          {user.photoURL ? (
            <Image
              style={styles.avatar}
              source={{ uri: user.photoURL }}
            />
          ) : (
            <Avatar.Icon
              style={styles.defaultAvatar}
              size={48}
              icon="account"
            />
          )}
          <View style={styles.followBadge}>
            <Ionicons name="add-circle" size={20} color="#fe2c55" />
          </View>
        </TouchableOpacity>

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
                data: post,
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

      {/* Bottom left: username + description */}
      <View style={[styles.textContainer, { paddingBottom: 16 + insets.bottom }]}>
        <Text style={styles.displayName}>
          @{user.displayName || user.email}
        </Text>
        <Text style={styles.description} numberOfLines={2}>
          {post.description}
        </Text>
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
  avatarContainer: {
    marginBottom: 24,
    alignItems: "center",
  },
  avatar: {
    height: 48,
    width: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "white",
  },
  defaultAvatar: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "white",
  },
  followBadge: {
    position: "absolute",
    bottom: -8,
    alignSelf: "center",
    backgroundColor: "white",
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
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
