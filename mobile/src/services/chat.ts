import { FIREBASE_AUTH, MOCK_USER_UID } from "../../firebaseConfig";
import { Chat, Message } from "../../types";

/**
 * Mock chat data. Replace with Supabase realtime when ready.
 */
const MOCK_CHATS: Chat[] = [
  {
    id: "chat-001",
    members: [MOCK_USER_UID, "user-002"],
    lastMessage: "Hey, how's your Spanish going?",
    lastUpdate: { seconds: Math.floor(Date.now() / 1000) },
    messages: [],
  },
];

const MOCK_MESSAGES: Record<string, Message[]> = {
  "chat-001": [
    { id: "m1", creator: "user-002", message: "Hey, how's your Spanish going?" },
    { id: "m2", creator: MOCK_USER_UID, message: "Getting better every day!" },
  ],
};

type ListenerCallback = (data: { docs: Array<{ id: string; data: () => any }> }) => void;

export const chatsListener = (listener: ListenerCallback) => {
  if (!FIREBASE_AUTH.currentUser) return;

  // Simulate snapshot
  setTimeout(() => {
    listener({
      docs: MOCK_CHATS.map((chat) => ({
        id: chat.id,
        data: () => ({ ...chat }),
      })),
    });
  }, 100);

  return () => {}; // unsubscribe
};

export const messagesListener = (listener: ListenerCallback, chatId: string) => {
  const msgs = MOCK_MESSAGES[chatId] || [];

  setTimeout(() => {
    listener({
      docs: msgs.map((msg) => ({
        id: msg.id,
        data: () => ({ ...msg }),
      })),
    });
  }, 100);

  return () => {}; // unsubscribe
};

export const sendMessage = async (chatId: string, message: string) => {
  if (!FIREBASE_AUTH.currentUser) return;

  const newMsg: Message = {
    id: `m-${Date.now()}`,
    creator: FIREBASE_AUTH.currentUser.uid,
    message,
  };

  if (!MOCK_MESSAGES[chatId]) {
    MOCK_MESSAGES[chatId] = [];
  }
  MOCK_MESSAGES[chatId].unshift(newMsg);
};

export const createChat = async (contactId: string) => {
  if (!FIREBASE_AUTH.currentUser) {
    throw new Error("User is not authenticated");
  }

  const newChat: Chat = {
    id: `chat-${Date.now()}`,
    members: [contactId, FIREBASE_AUTH.currentUser.uid],
    lastMessage: "Send a first message",
    messages: [],
  };
  MOCK_CHATS.push(newChat);

  return { id: newChat.id };
};
