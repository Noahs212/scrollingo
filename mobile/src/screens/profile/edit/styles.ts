import { StyleSheet } from "react-native";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  imageContainer: {
    alignItems: "center",
    marginTop: 20,
  },
  imageViewContainer: {
    backgroundColor: "gray",
    height: 100,
    width: 100,
    borderRadius: 50,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    height: 100,
    width: 100,
    position: "absolute",
  },
  placeholderImage: {
    backgroundColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
  },
  imageOverlay: {
    backgroundColor: "rgba(0,0,0, 0.5)",
    ...(StyleSheet.absoluteFill as object),
  },
  fieldsContainer: {
    marginTop: 20,
    padding: 20,
    flex: 1,
  },
  fieldItemContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  fieldValueContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  fieldValueText: {
    color: "gray",
    marginRight: 4,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 40,
    paddingVertical: 12,
    borderColor: "red",
    borderWidth: 1,
    borderRadius: 8,
  },
  logoutButtonText: {
    color: "red",
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
  },
});

export default styles;
