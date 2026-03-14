import React from "react";
import { View, Text, Image } from "react-native";
import { useUser } from "../../../../hooks/useUser";
import { generalStyles } from "../../../../styles";
import styles from "./styles";
import { useCurrentUserId } from "../../../../hooks/useCurrentUserId";
import { Message } from "../../../../../types";
import { Avatar } from "react-native-paper";

const ChatSingleItem = ({ item }: { item: Message }) => {
  const currentUserId = useCurrentUserId();
  const { data: userData, isLoading } = useUser(item.creator);

  if (isLoading) {
    return <></>;
  }

  const isCurrentUser = currentUserId && item.creator === currentUserId;

  return (
    <View
      style={isCurrentUser ? styles.containerCurrent : styles.containerOther}
    >
      {userData && userData.photoURL ? (
        <Image
          style={generalStyles.avatarSmall}
          source={{ uri: userData.photoURL }}
        />
      ) : (
        <Avatar.Icon size={32} icon={"account"} />
      )}
      <View
        style={
          isCurrentUser
            ? styles.containerTextCurrent
            : styles.containerTextOther
        }
      >
        <Text style={styles.text}>{item.message}</Text>
      </View>
    </View>
  );
};

export default ChatSingleItem;
