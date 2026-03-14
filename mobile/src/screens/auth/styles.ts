import { StyleSheet } from "react-native";

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 60,
    backgroundColor: "#fff",
  },
  header: {
    alignItems: "center",
    marginBottom: 36,
  },
  appName: {
    fontSize: 36,
    fontWeight: "800",
    color: "#111",
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 14,
    color: "#888",
    marginTop: 8,
  },
  errorText: {
    color: "#e53935",
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
  },
  form: {
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: "#fafafa",
    color: "#111",
  },
  submitButton: {
    backgroundColor: "#e53935",
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  submitButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#ddd",
  },
  dividerText: {
    marginHorizontal: 16,
    color: "#999",
    fontSize: 14,
  },
  oauthContainer: {
    marginBottom: 32,
  },
  oauthButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingVertical: 14,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  oauthButtonText: {
    marginLeft: 10,
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  oauthButtonApple: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  oauthButtonTextApple: {
    marginLeft: 10,
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  switchRow: {
    alignItems: "center",
  },
  switchText: {
    fontSize: 14,
    color: "#666",
  },
  switchTextBold: {
    fontWeight: "700",
    color: "#e53935",
  },
});

export default styles;
