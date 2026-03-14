import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setChats } from "../redux/slices/chatSlice";
import { chatsListener } from "../services/chat";
import { RootState } from "../redux/store";
import { Chat } from "../../types";

export const useChats = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state: RootState) => state.auth.currentUser);

  const handleChatsChange = useCallback(
    (change: { docs: Array<{ id: string; data: () => any }> }) => {
      dispatch(
        setChats(
          change.docs.map((item) => ({ id: item.id, ...item.data() }) as Chat),
        ),
      );
    },
    [dispatch],
  );

  useEffect(() => {
    let listenerInstance: (() => void) | undefined;
    if (currentUser != null) {
      listenerInstance = chatsListener(handleChatsChange);
    }

    return () => {
      listenerInstance && listenerInstance();
    };
  }, [handleChatsChange, currentUser]);
};
