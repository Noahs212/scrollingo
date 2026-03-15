// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const ChatScreen = () => {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Inbox</Text>
      <View style={styles.placeholder}>
        <Ionicons name="chatbubbles-outline" size={48} color="#444" />
        <Text style={styles.placeholderText}>
          Messages from other learners will appear here
        </Text>
        <Text style={styles.comingSoon}>Coming soon</Text>
      </View>
    </SafeAreaView>
  );
};

export default ChatScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  title: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    paddingVertical: 16,
  },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  placeholderText: {
    color: "#888",
    fontSize: 16,
    textAlign: "center",
    paddingHorizontal: 40,
  },
  comingSoon: {
    color: "#555",
    fontSize: 13,
    marginTop: 4,
  },
});
