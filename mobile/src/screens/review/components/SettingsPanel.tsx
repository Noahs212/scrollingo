import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useDispatch } from "react-redux";
import { updateUserField } from "../../../redux/slices/authSlice";
import { saveUserField } from "../../../services/user";
import { AppDispatch } from "../../../redux/store";

interface Props {
  currentMax: number;
  onClose: () => void;
}

export default function SettingsPanel({ currentMax, onClose }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const [value, setValue] = useState(String(currentMax));

  const handleSave = () => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > 100) return;

    dispatch(updateUserField({ field: "maxReviewsPerDay", value: num }));
    saveUserField("maxReviewsPerDay", String(num)).catch(() => {});
    onClose();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="options-outline" size={18} color="#888" />
        <Text style={styles.headerText}>Daily Limits</Text>
      </View>

      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Max reviews per day</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          keyboardType="number-pad"
          maxLength={3}
          selectTextOnFocus
          placeholderTextColor="#555"
        />
      </View>

      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
        <Text style={styles.saveButtonText}>Save Settings</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 20,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  headerText: {
    color: "#ccc",
    fontSize: 15,
    fontWeight: "600",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  fieldLabel: {
    color: "#aaa",
    fontSize: 14,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    width: 70,
    textAlign: "center",
  },
  saveButton: {
    backgroundColor: "#3b82f6",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
});
