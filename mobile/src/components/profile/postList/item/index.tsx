import { Image, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Video } from "../../../../../types";

export default function ProfilePostListItem({ item }: { item: Video }) {
  return (
    <TouchableOpacity style={styles.container}>
      {item.thumbnail_url ? (
        <Image style={styles.image} source={{ uri: item.thumbnail_url }} />
      ) : (
        <View style={[styles.image, { backgroundColor: "#1a1a1a" }]} />
      )}
    </TouchableOpacity>
  );
}
