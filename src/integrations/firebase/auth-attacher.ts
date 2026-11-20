import { createMiddleware } from "@tanstack/react-start";
import { auth } from "@/lib/firebase";

export const attachFirebaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  return next({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
