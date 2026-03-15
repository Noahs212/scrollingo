// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { View, Text, TouchableOpacity } from "react-native";
import styles from "./styles";
import { Feather } from "@expo/vector-icons";
import { RootState } from "../../../redux/store";

export default function ProfileNavBar({
  user,
}: {
  user: RootState["auth"]["currentUser"];
}) {
  return (
    user && (
      <View style={styles.container}>
        <TouchableOpacity>
          <Feather name="search" size={20} />
        </TouchableOpacity>
        <Text style={styles.text}>{user.email}</Text>
        <TouchableOpacity>
          <Feather name="menu" size={24} />
        </TouchableOpacity>
      </View>
    )
  );
}
