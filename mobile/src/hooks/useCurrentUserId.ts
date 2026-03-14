import { useSelector } from "react-redux";
import { RootState } from "../redux/store";

export function useCurrentUserId(): string | null {
  return useSelector(
    (state: RootState) => state.auth.currentUser?.uid ?? null,
  );
}
