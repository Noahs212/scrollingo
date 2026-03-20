import {
  FlatList,
  View,
  Text,
  Dimensions,
  ViewToken,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import PostSingle, { PostSingleHandles } from "../../components/general/post";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { getFeed, getPostsByUserId } from "../../services/posts";
import { Post } from "../../../types";
import { RouteProp, useIsFocused } from "@react-navigation/native";
import { RootStackParamList } from "../../navigation/main";
import { HomeStackParamList } from "../../navigation/home";
import {
  CurrentUserProfileItemInViewContext,
  FeedStackParamList,
} from "../../navigation/feed";
import useMaterialNavBarHeight from "../../hooks/useMaterialNavBarHeight";
import { useCurrentUserId } from "../../hooks/useCurrentUserId";
import { RootState } from "../../redux/store";
import { setActiveLearningLanguage } from "../../redux/slices/languageSlice";
import {
  LEARNING_LANGUAGES,
  updateActiveLanguage,
} from "../../services/language";

type FeedScreenRouteProp =
  | RouteProp<RootStackParamList, "userPosts">
  | RouteProp<HomeStackParamList, "feed">
  | RouteProp<FeedStackParamList, "feedList">;

interface PostViewToken extends ViewToken {
  item: Post;
}

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get("window");

function LanguageDropdown({
  onLanguageChange,
}: {
  onLanguageChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dispatch = useDispatch();
  const userId = useCurrentUserId();
  const { learningLanguages, activeLearningLanguage } = useSelector(
    (state: RootState) => state.language,
  );

  if (learningLanguages.length < 2) return null;

  const activeInfo = LEARNING_LANGUAGES.find(
    (l) => l.code === activeLearningLanguage,
  );
  const activeLabel = activeInfo
    ? `${activeInfo.flag} ${activeInfo.name}`
    : activeLearningLanguage ?? "";

  const handleSelect = (code: string) => {
    setOpen(false);
    if (code === activeLearningLanguage) return;
    dispatch(setActiveLearningLanguage(code));
    onLanguageChange(code);
    if (userId) {
      updateActiveLanguage(userId, code).catch(() => {});
    }
  };

  return (
    <View style={dropdownStyles.container} pointerEvents="box-none">
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setOpen((v) => !v)}
        style={dropdownStyles.trigger}
      >
        <Text style={dropdownStyles.triggerText}>{activeLabel}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color="white"
        />
      </TouchableOpacity>
      {open && (
        <View style={dropdownStyles.menu}>
          {learningLanguages.map((code) => {
            const info = LEARNING_LANGUAGES.find((l) => l.code === code);
            const isActive = code === activeLearningLanguage;
            return (
              <TouchableOpacity
                key={code}
                style={[
                  dropdownStyles.option,
                  isActive && dropdownStyles.optionActive,
                ]}
                onPress={() => handleSelect(code)}
              >
                <Text style={dropdownStyles.optionText}>
                  {info ? `${info.flag} ${info.name}` : code}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const dropdownStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 50,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "center",
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  triggerText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  menu: {
    marginTop: 4,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 12,
    overflow: "hidden",
    minWidth: 140,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  optionActive: {
    backgroundColor: "rgba(254,44,85,0.3)",
  },
  optionText: {
    color: "white",
    fontSize: 14,
  },
});

export default function FeedScreen({ route }: { route: FeedScreenRouteProp }) {
  const { setCurrentUserProfileItemInView } = useContext(
    CurrentUserProfileItemInViewContext,
  );

  const { creator = "", profile = false } = (route.params ?? {}) as {
    creator?: string;
    profile?: boolean;
  };

  const isFocused = useIsFocused();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const mediaRefs = useRef<Record<string, PostSingleHandles | null>>({});
  const currentViewableKey = useRef<string | null>(null);

  const navBarHeight = useMaterialNavBarHeight(profile);
  const feedItemHeight = SCREEN_HEIGHT - navBarHeight;

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const result =
        profile && creator
          ? await getPostsByUserId(creator)
          : await getFeed();
      setPosts(result);
    } finally {
      setLoading(false);
    }
  }, [profile, creator]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleLanguageChange = useCallback(
    (_code: string) => {
      fetchPosts();
    },
    [fetchPosts],
  );

  const onViewableItemsChanged = useRef(
    ({ changed }: { changed: PostViewToken[] }) => {
      changed.forEach((element) => {
        const cell = mediaRefs.current[element.key];
        if (cell) {
          if (element.isViewable) {
            currentViewableKey.current = element.key;
            if (!profile && setCurrentUserProfileItemInView) {
              setCurrentUserProfileItemInView(element.item.creator);
            }
            cell.play();
          } else {
            cell.stop();
          }
        }
      });
    },
  );

  // Pause all videos when tab loses focus, resume active video when refocused
  useEffect(() => {
    if (isFocused) {
      const key = currentViewableKey.current;
      if (key) {
        const cell = mediaRefs.current[key];
        cell?.play();
      }
    } else {
      Object.values(mediaRefs.current).forEach((cell) => {
        cell?.stop();
      });
    }
  }, [isFocused]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<Post> | null | undefined, index: number) => ({
      length: feedItemHeight,
      offset: feedItemHeight * index,
      index,
    }),
    [feedItemHeight],
  );

  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <View
        style={[styles.feedItem, { height: feedItemHeight }]}
      >
        <PostSingle
          item={item}
          ref={(ref) => {
            mediaRefs.current[item.id] = ref;
          }}
        />
      </View>
    ),
    [feedItemHeight],
  );

  const keyExtractor = useCallback((item: Post) => item.id, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar hidden />
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <StatusBar hidden />
        <Ionicons name="videocam-outline" size={64} color="#888" />
        <Text style={styles.emptyTitle}>No videos yet</Text>
        <Text style={styles.emptySubtitle}>
          Videos in your learning language will appear here
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      {!profile && (
        <LanguageDropdown onLanguageChange={handleLanguageChange} />
      )}
      <FlatList
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        pagingEnabled
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        snapToInterval={feedItemHeight}
        snapToAlignment="start"
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        viewabilityConfig={{
          itemVisiblePercentThreshold: 50,
        }}
        onViewableItemsChanged={onViewableItemsChanged.current}
        bounces={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "black",
    justifyContent: "center",
    alignItems: "center",
  },
  feedItem: {
    width: SCREEN_WIDTH,
    backgroundColor: "black",
    overflow: "hidden",
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: "black",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 16,
  },
  emptySubtitle: {
    color: "#888",
    fontSize: 15,
    marginTop: 8,
    textAlign: "center",
  },
});
