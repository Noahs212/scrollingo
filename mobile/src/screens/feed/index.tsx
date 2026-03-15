import {
  FlatList,
  View,
  Dimensions,
  ViewToken,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import PostSingle, { PostSingleHandles } from "../../components/general/post";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
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

type FeedScreenRouteProp =
  | RouteProp<RootStackParamList, "userPosts">
  | RouteProp<HomeStackParamList, "feed">
  | RouteProp<FeedStackParamList, "feedList">;

interface PostViewToken extends ViewToken {
  item: Post;
}

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get("window");

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

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const result =
          profile && creator
            ? await getPostsByUserId(creator)
            : await getFeed();
        setPosts(result);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, []);

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

  return (
    <View style={styles.container}>
      <StatusBar hidden />
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
});
