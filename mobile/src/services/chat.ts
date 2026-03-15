// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { Chat, Message } from "../../types";

/**
 * Mock chat data. Replace with Supabase realtime when ready.
 */
const MOCK_USER_ID = "mock-user-001";

const MOCK_CHATS: Chat[] = [
  {
    id: "chat-001",
    members: [MOCK_USER_ID, "user-002"],
    lastMessage: "Hey, how's your Spanish going?",
    lastUpdate: { seconds: Math.floor(Date.now() / 1000) },
    messages: [],
  },
];

const MOCK_MESSAGES: Record<string, Message[]> = {
  "chat-001": [
    { id: "m1", creator: "user-002", message: "Hey, how's your Spanish going?" },
    { id: "m2", creator: MOCK_USER_ID, message: "Getting better every day!" },
  ],
};

type ListenerCallback = (data: { docs: Array<{ id: string; data: () => any }> }) => void;

export const chatsListener = (listener: ListenerCallback) => {
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

export const sendMessage = async (chatId: string, message: string, currentUserId: string) => {
  if (!currentUserId) return;

  const newMsg: Message = {
    id: `m-${Date.now()}`,
    creator: currentUserId,
    message,
  };

  if (!MOCK_MESSAGES[chatId]) {
    MOCK_MESSAGES[chatId] = [];
  }
  MOCK_MESSAGES[chatId].unshift(newMsg);
};

export const createChat = async (contactId: string, currentUserId: string) => {
  if (!currentUserId) {
    throw new Error("User is not authenticated");
  }

  const newChat: Chat = {
    id: `chat-${Date.now()}`,
    members: [contactId, currentUserId],
    lastMessage: "Send a first message",
    messages: [],
  };
  MOCK_CHATS.push(newChat);

  return { id: newChat.id };
};
