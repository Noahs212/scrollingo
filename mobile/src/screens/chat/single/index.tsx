// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const ChatSingleScreen = () => {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.placeholder}>
        <Ionicons name="chatbubble-outline" size={48} color="#444" />
        <Text style={styles.placeholderText}>Chat coming soon</Text>
      </View>
    </SafeAreaView>
  );
};

export default ChatSingleScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
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
  },
});
