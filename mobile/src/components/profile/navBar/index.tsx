import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
} from "react-native";
import navStyles from "./styles";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../navigation/main";
import { RootState } from "../../../redux/store";
import { useCurrentUserId } from "../../../hooks/useCurrentUserId";

export default function ProfileNavBar({
  user,
}: {
  user: RootState["auth"]["currentUser"];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const currentUserId = useCurrentUserId();
  const isOwnProfile = user?.uid === currentUserId;
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    user && (
      <>
        <View style={navStyles.container}>
          <TouchableOpacity>
            <Feather name="search" size={20} />
          </TouchableOpacity>
          <Text style={navStyles.text}>
            {user.displayName || user.email}
          </Text>
          {isOwnProfile ? (
            <TouchableOpacity onPress={() => setMenuOpen(true)}>
              <Feather name="menu" size={24} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        {/* Slide-out menu */}
        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <Pressable
            style={menuStyles.backdrop}
            onPress={() => setMenuOpen(false)}
          >
            <Pressable
              style={menuStyles.panel}
              onPress={(e) => e.stopPropagation()}
            >
              <TouchableOpacity
                style={menuStyles.item}
                onPress={() => {
                  setMenuOpen(false);
                  navigation.navigate("settings");
                }}
              >
                <Feather name="settings" size={20} color="#333" />
                <Text style={menuStyles.itemText}>Settings</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={menuStyles.item}
                onPress={() => {
                  setMenuOpen(false);
                  navigation.navigate("editProfile");
                }}
              >
                <Feather name="edit-2" size={20} color="#333" />
                <Text style={menuStyles.itemText}>Edit Profile</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      </>
    )
  );
}

const menuStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  panel: {
    backgroundColor: "white",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemText: {
    fontSize: 16,
    color: "#333",
  },
});
