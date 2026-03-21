import { View, FlatList } from "react-native";
import ProfilePostListItem from "./item";
import styles from "./styles";
import { Video } from "../../../../types";

export default function ProfilePostList({
  videos,
}: {
  videos: Video[];
}) {
  return (
    <View style={styles.container}>
      <FlatList
        numColumns={3}
        scrollEnabled={false}
        removeClippedSubviews
        nestedScrollEnabled
        data={videos}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ProfilePostListItem item={item} index={index} />
        )}
      />
    </View>
  );
}
