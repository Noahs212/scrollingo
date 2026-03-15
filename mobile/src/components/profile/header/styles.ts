import { StyleSheet } from "react-native";

const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
    alignItems: "center",
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderColor: "lightgray",
  },
  avatar: {
    height: 80,
    width: 80,
    borderRadius: 40,
  },
  emailText: {
    paddingTop: 12,
    paddingBottom: 8,
    fontSize: 16,
    fontWeight: "600",
  },

  // Language badges
  languageContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 16,
  },
  languageBadge: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  languageBadgeText: {
    fontSize: 12,
    color: "#555",
  },
  learningBadge: {
    backgroundColor: "#e8f5e9",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  learningBadgeText: {
    fontSize: 12,
    color: "#2e7d32",
  },

  // Social counters
  counterContainer: {
    paddingBottom: 16,
    flexDirection: "row",
    width: "100%",
  },
  counterItemContainer: {
    flex: 1,
    alignItems: "center",
  },
  counterNumberText: {
    fontWeight: "bold",
    fontSize: 16,
  },
  counterLabelText: {
    color: "gray",
    fontSize: 11,
  },

  // Learning stats
  statsContainer: {
    flexDirection: "row",
    width: "100%",
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingTop: 12,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statEmoji: {
    fontSize: 20,
    marginBottom: 2,
  },
  statNumber: {
    fontWeight: "bold",
    fontSize: 16,
  },
  statLabel: {
    color: "gray",
    fontSize: 11,
  },
});

export default styles;
