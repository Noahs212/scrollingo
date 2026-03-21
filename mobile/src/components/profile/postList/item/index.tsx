import { Image, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Video } from "../../../../../types";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../../navigation/main";

export default function ProfilePostListItem({
  item,
  index,
}: {
  item: Video;
  index: number;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() =>
        navigation.navigate("userPosts", {
          creator: item.creator_id ?? "",
          profile: true,
          initialIndex: index,
        })
      }
    >
      {item.thumbnail_url ? (
        <Image style={styles.image} source={{ uri: item.thumbnail_url }} />
      ) : (
        <View style={[styles.image, { backgroundColor: "#1a1a1a" }]} />
      )}
    </TouchableOpacity>
  );
}
