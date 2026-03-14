import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function SearchScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Discover</Text>
      <View style={styles.placeholder}>
        <Ionicons name="search-outline" size={48} color="#444" />
        <Text style={styles.placeholderText}>
          Search for language lessons and creators
        </Text>
        <Text style={styles.comingSoon}>Coming soon</Text>
      </View>
    </SafeAreaView>
  );
}

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
