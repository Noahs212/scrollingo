// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { View, FlatList } from "react-native";
import ProfilePostListItem from "./item";
import styles from "./styles";
import { RootState } from "../../../redux/store";

export default function ProfilePostList({
  posts,
}: {
  posts: RootState["post"]["currentUserPosts"];
}) {
  return (
    <View style={styles.container}>
      <FlatList
        numColumns={3}
        scrollEnabled={false}
        removeClippedSubviews
        nestedScrollEnabled
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ProfilePostListItem item={item} />}
      />
    </View>
  );
}
