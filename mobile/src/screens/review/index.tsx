import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function ReviewScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Ionicons name="book-outline" size={64} color="#888" />
        <Text style={styles.title}>No saved words yet</Text>
        <Text style={styles.subtitle}>
          Tap words in video subtitles to save them for review
        </Text>
        <Text style={styles.note}>
          Spaced repetition coming in a future update
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  title: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 16,
  },
  subtitle: {
    color: "#888",
    fontSize: 15,
    marginTop: 8,
    textAlign: "center",
  },
  note: {
    color: "#666",
    fontSize: 13,
    marginTop: 16,
    textAlign: "center",
  },
});
